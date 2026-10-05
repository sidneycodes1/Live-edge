import { ProviderError } from '../aggregator/errors.js';
import { makeLiveChannel } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// Floor client (Livepeer) — the LAST rung of the never-empty ladder, so it is
// intentionally the most stubborn about producing something. Two duties:
//
//  1) BEST-EFFORT discovery (only when LIVEPEER_API_KEY is set): list currently
//     live streams from the Livepeer Studio Management API.
//      https://docs.livepeer.com/references/api-reference/streams/list
//      GET https://api.livepeer.com/studio/streams?status=live&limit=<n>
//        headers: Authorization: Bearer <API key>
//        resp: { data: [ { id, name, playbackId, ready, ... } ], total, next }
//     This is treated as OPTIONAL enrichment — any failure degrades to [] like
//     every other client.
//
//  2) GUARANTEED fallback (NO network, always available if configured): a single
//     self-hosted / always-on Livepeer channel built straight from env
//     (FLOOR_LIVEPEER_URL + title/channel/category). This is the rung that makes
//     the grid never blank even when Twitch/Kick/YouTube are all down AND nothing
//     is cached — see ../aggregator/index.js. If it is unconfigured we return []
//     (honest empty) rather than fabricate a stream that may not play.
//
// `category` stays source-native / config-supplied — never an invented bucket.
// Public methods never throw. Secret (API key) is never logged.
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.livepeer.com';

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

// Build a Livepeer HLS playback URL only when BOTH a playbackId and a configured
// base exist; otherwise leave blank (render a "no preview"/audio-only tile) so we
// never point the grid at a guessed host that could 404.
function floorHlsUrl(playbackId, hlsBase) {
  if (!playbackId || !hlsBase) return '';
  return `${hlsBase.replace(/\/+$/, '')}/${playbackId}/index.m3u8`;
}

export function normalizeFloorStream(raw, { hlsBase }) {
  return makeLiveChannel({
    source: 'floor',
    nativeId: raw.id || raw.playbackId || '',
    title: raw.name,
    channelName: raw.name || 'Livepeer',
    channelSlug: raw.id || raw.playbackId || '',
    category: '',
    viewerCount: raw.viewer_count ?? raw.viewers ?? 0,
    startedAt: raw.createdAt || raw.created_at || null,
    thumbnailUrl: raw.thumbnailUrl || raw.poster || '',
    isLive: raw.ready === true || raw.status === 'active' || true,
    isMature: false,
    watchUrl: floorHlsUrl(raw.playbackId, hlsBase) || null,
    language: null,
  });
}

export function createFloorClient({
  apiKey,
  hlsBase = 'https://stream.livepeer.com',
  // Guaranteed (network-free) fallback channel — the ladder's terminal rung:
  fallback = { url: '', title: '', channelName: '', category: '', thumbnailUrl: '' },
  fetchImpl = fetch,
  cacheTtlMs = 45000,
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const hasDiscoveryCreds = () => Boolean(apiKey);
  const hasGuaranteed = () => Boolean(fallback && fallback.url);

  let listCache = null;
  let listInflight = null;

  async function apiGet(pathWithQuery) {
    if (!hasDiscoveryCreds()) throw new ProviderError('MISSING_CREDENTIALS', 'Livepeer API key not configured');
    const res = await fetchImpl(`${API_BASE}${pathWithQuery}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = await safeJson(res);
    if (!res.ok) {
      throw new ProviderError('HTTP_ERROR', `Livepeer request failed (${res.status})`, { status: res.status });
    }
    return json;
  }

  // Best-effort live discovery. Never throws → [] on any problem (creds absent,
  // upstream down, empty), with cache-aside + stale fallback like every sibling.
  async function getTopLiveChannels(limit = 10) {
    if (!hasDiscoveryCreds()) {
      // No discovery is fine — the guaranteed fallback still keeps the grid alive.
      return [];
    }
    const first = clampInt(limit, 1, 100, 10);
    const at = now();
    if (listCache && listCache.key === first && at - listCache.at < cacheTtlMs) {
      return listCache.data;
    }
    if (!listInflight) {
      listInflight = (async () => {
        try {
          const json = await apiGet(`/studio/streams?status=live&limit=${first}`);
          const data = (json.data || []).map((s) => normalizeFloorStream(s, { hlsBase }));
          listCache = { key: first, at: now(), data };
          return data;
        } catch (e) {
          warn(`Floor getTopLiveChannels failed → serving ${listCache ? 'stale' : 'empty'} (${e.code || e.name})`);
          return listCache ? listCache.data : [];
        } finally {
          listInflight = null;
        }
      })();
    }
    return listInflight;
  }

  // The ladder's terminal rung: one configured always-live channel, built with NO
  // network. Returns [] only when floor is genuinely unconfigured (honest empty —
  // we never fake a stream that might not play).
  function getGuaranteedChannel() {
    if (!hasGuaranteed()) return [];
    return [
      makeLiveChannel({
        source: 'floor',
        nativeId: 'floor-fallback',
        title: fallback.title || 'Live on Livepeer',
        channelName: fallback.channelName || 'LiveEdge Floor',
        channelSlug: 'floor-fallback',
        category: fallback.category || '',
        viewerCount: 0,
        startedAt: null,
        thumbnailUrl: fallback.thumbnailUrl || '',
        isLive: true,
        isMature: false,
        watchUrl: fallback.url,
        language: null,
      }),
    ];
  }

  return {
    hasDiscoveryCreds,
    hasGuaranteed,
    getTopLiveChannels,
    getGuaranteedChannel,
  };
}
