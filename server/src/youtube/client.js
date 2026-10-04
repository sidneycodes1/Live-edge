import { ProviderError } from '../aggregator/errors.js';
import { makeLiveChannel } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// YouTube client — mirrors ../twitch/client.js's public boundary (cache-aside +
// stale fallback + never-throws). YouTube Data API v3 needs only an API key (no
// OAuth token), so there is no single-flight token dance; the single-flight here
// is on the two-step list fetch itself.
//
// Endpoint shapes verified against the OFFICIAL docs (cited):
//  - Search: list — discover currently-live broadcasts:
//      https://developers.google.com/youtube/v3/docs/search/list
//      GET https://www.googleapis.com/youtube/v3/search
//        ?part=snippet&type=video&eventType=live&maxResults=<1..50>&q=<query>&key=<API_KEY>
//        resp.items[]: id.videoId, snippet.{title,channelId,channelTitle,
//                      publishedAt,thumbnails,liveBroadcastContent}
//      (eventType=live requires type=video; maxResults 0..50, default 5). Search
//      carries NO viewer count and may include upcoming/completed items, so we
//      filter liveBroadcastContent==='live' then enrich.
//  - Videos: list — real concurrent viewers + accurate start + best thumbnail:
//      https://developers.google.com/youtube/v3/docs/videos/list
//      GET https://www.googleapis.com/youtube/v3/videos
//        ?part=snippet,liveStreamingDetails&id=<csv>&key=<API_KEY>
//        items[]: liveStreamingDetails.{concurrentViewers,actualStartTime},
//                 snippet.{title,channelTitle,thumbnails}
//
// `category` is left source-native: the Data API exposes only a numeric
// snippet.categoryId (not a human label), so we do NOT invent a taxonomy bucket —
// empty unless the caller configured a query label. Never throws at the boundary.
// ---------------------------------------------------------------------------

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function pickThumb(thumbnails) {
  const t = thumbnails || {};
  return (t.medium?.url) || (t.high?.url) || (t.default?.url) || '';
}

// Combine a search item (identity/title) with its videos.list detail row (viewers/
// start/thumb) into one LiveChannel. Missing detail (e.g. videos call partially
// failed) still yields a usable channel with viewerCount 0 rather than dropping it.
export function normalizeYouTubeChannel(searchItem, detail) {
  const videoId = searchItem?.id?.videoId || detail?.id || '';
  const sSnippet = searchItem?.snippet || {};
  const dSnippet = detail?.snippet || {};
  const lsd = detail?.liveStreamingDetails || {};
  const channelTitle = dSnippet.channelTitle || sSnippet.channelTitle || '';
  return makeLiveChannel({
    source: 'youtube',
    nativeId: videoId,
    title: dSnippet.title || sSnippet.title,
    channelName: channelTitle,
    channelSlug: dSnippet.channelId || sSnippet.channelId || '',
    category: '', // numeric categoryId only in the API → no invented label
    viewerCount: lsd.concurrentViewers,
    startedAt: lsd.actualStartTime || sSnippet.publishedAt,
    thumbnailUrl: pickThumb(dSnippet.thumbnails) || pickThumb(sSnippet.thumbnails),
    isLive: true,
    isMature: false,
    watchUrl: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null,
    language: null,
  });
}

export function createYouTubeClient({
  apiKey,
  query = 'live',
  // Phase 3 (Tier-B): optional [{q, category?}...] (plain strings allowed).
  // When present it REPLACES the single `query`: results are merged and deduped
  // by video id. Quota honest: each search costs 100 units regardless of how
  // the calls are scheduled — so we fire them CONCURRENTLY (one round-trip
  // budget, not N) and tolerate partial failure. A sequential fan-out blew the
  // aggregator's per-provider timeout in the live proof (see aggregator/index.js).
  queries = null,
  fetchImpl = fetch,
  cacheTtlMs = 45000,
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const hasCreds = () => Boolean(apiKey);

  const qlist = (Array.isArray(queries) && queries.length ? queries : [query])
    .map((s) => (typeof s === 'string' ? { q: s } : s))
    .filter((s) => s && typeof s.q === 'string' && s.q.trim());

  let listCache = null;
  let listInflight = null;

  async function apiGet(pathWithQuery) {
    if (!hasCreds()) throw new ProviderError('MISSING_CREDENTIALS', 'YouTube API key not configured');
    const res = await fetchImpl(`${API_BASE}${pathWithQuery}`, { method: 'GET' });
    const json = await safeJson(res);
    if (!res.ok) {
      throw new ProviderError('HTTP_ERROR', `YouTube request failed (${res.status})`, { status: res.status });
    }
    return json;
  }

  // One search query → live items (throws ProviderError on failure).
  async function fetchQuery(spec, maxResults) {
    const search = await apiGet(
      `/search?part=snippet&type=video&eventType=live&maxResults=${maxResults}` +
        `&q=${encodeURIComponent(spec.q)}&key=${encodeURIComponent(apiKey)}`,
    );
    // Keep only genuinely-live items (search can return upcoming/completed).
    const liveItems = (search.items || []).filter((it) => it?.snippet?.liveBroadcastContent === 'live');
    if (liveItems.length === 0) return [];

    const ids = liveItems.map((it) => it?.id?.videoId).filter(Boolean);
    let detailById = {};
    if (ids.length) {
      // Best-effort enrichment: a failed/omitted videos call must not drop the
      // results we already have — fall back to search-only mapping.
      try {
        const videos = await apiGet(
          `/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(ids.join(','))}&key=${encodeURIComponent(apiKey)}`,
        );
        for (const d of videos.items || []) detailById[d.id] = d;
      } catch (e) {
        warn(`YouTube videos enrichment failed → using search data (${e.code || e.name})`);
      }
    }
    // Combine search + detail. A video whose liveStreamingDetails.actualEndTime is
    // SET has ENDED — search indexing lags reality by minutes, so without this
    // prune a finished game keeps a LIVE badge until it ages out of the cache.
    // Enrichment failures leave detailById empty → items are kept (best-effort:
    // we only remove what we can PROVE is over; we never guess one in or out).
    const out = [];
    for (const it of liveItems) {
      const detail = detailById[it?.id?.videoId];
      if (detail?.liveStreamingDetails?.actualEndTime) continue;
      const ch = normalizeYouTubeChannel(it, detail);
      // Operator-assigned query label (like the curated list's curation tag) —
      // only fills the source-native-empty category, never overrides it.
      if (spec.category && !ch.category) ch.category = spec.category;
      out.push(ch);
    }
    return out;
  }

  // Internal fetch across ALL configured queries. Concurrent (single round-trip
  // budget), deduped by video id. Throws only when EVERY query failed.
  async function fetchLive(limit) {
    const maxResults = clampInt(limit, 1, 50, 10);
    // Fair-share: split the budget across queries so one saturated topic (e.g.
    // 'football live' during NFL Sunday) can't crowd the rest off the grid.
    const perQuery = qlist.length > 1 ? Math.max(5, Math.ceil(maxResults / qlist.length)) : maxResults;
    const settled = await Promise.all(
      qlist.map(async (spec) => {
        try {
          return { items: await fetchQuery(spec, perQuery), err: null };
        } catch (e) {
          warn(`YouTube query "${spec.q}" failed (${e.code || e.name})`);
          return { items: [], err: e };
        }
      }),
    );
    const seen = new Set();
    const merged = [];
    for (const r of settled) {
      for (const ch of r.items) {
        const key = ch.nativeId || ch.watchUrl || ch.title;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(ch);
        }
      }
    }
    const lastErr = settled.find((r) => r.err)?.err;
    if (merged.length === 0 && lastErr) throw lastErr;
    return merged.slice(0, maxResults);
  }

  // Public: never throws. LiveChannel[] ([] on any problem). Cache-aside per limit
  // with stale fallback on failure.
  async function getTopLiveChannels(limit = 10) {
    if (!hasCreds()) {
      warn('YouTube getTopLiveChannels: no API key → returning empty (demo/fallback mode)');
      return [];
    }
    const first = clampInt(limit, 1, 50, 10);
    const at = now();
    if (listCache && listCache.key === first && at - listCache.at < cacheTtlMs) {
      return listCache.data;
    }
    if (!listInflight) {
      listInflight = (async () => {
        try {
          const data = await fetchLive(first);
          listCache = { key: first, at: now(), data };
          return data;
        } catch (e) {
          warn(`YouTube getTopLiveChannels failed → serving ${listCache ? 'stale' : 'empty'} (${e.code || e.name})`);
          return listCache ? listCache.data : [];
        } finally {
          listInflight = null;
        }
      })();
    }
    return listInflight;
  }

  return {
    hasCreds,
    getTopLiveChannels,
  };
}
