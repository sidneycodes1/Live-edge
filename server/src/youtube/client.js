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
  fetchImpl = fetch,
  cacheTtlMs = 45000,
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const hasCreds = () => Boolean(apiKey);

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

  // Internal two-step fetch. Throws so tests can assert failure paths.
  async function fetchLive(limit) {
    const maxResults = clampInt(limit, 1, 50, 10);
    const search = await apiGet(
      `/search?part=snippet&type=video&eventType=live&maxResults=${maxResults}` +
        `&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`,
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
    return liveItems.map((it) => normalizeYouTubeChannel(it, detailById[it?.id?.videoId]));
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
