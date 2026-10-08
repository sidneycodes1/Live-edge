import { ProviderError } from '../aggregator/errors.js';
import { makeLiveChannel, bucketForCategory } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// Kick client — the PRIMARY real-stream provider since the Twitch retirement
// (Oct 2026). Kick's official Developer API uses the client-credentials
// app-token flow (single-flight token + cache-aside list + stale fallback +
// never-throws public boundary).
//
// Endpoint shapes verified against the official Kick Developer docs (cited):
//  - App Access Token (client credentials grant):
//      POST https://id.kick.com/oauth/token
//        body (x-www-form-urlencoded): client_id, client_secret, grant_type=client_credentials
//        resp: { access_token, expires_in (seconds), token_type: "Bearer" }
//      (docs.kick.com "Getting an App Access Token"; standard OAuth 2.1
//       client-credentials grant — no JWT signing / private key needed)
//  - Get Livestreams (public, app-token auth):
//      GET https://api.kick.com/public/v1/livestreams?limit=<1..100>&sort=viewer_count
//        headers: Authorization: Bearer <app token>
//        resp.data[]: broadcaster_user_id, slug, stream_title, viewer_count,
//                     started_at, language, has_mature_content,
//                     category { id, name }, custom_tags[]
//  - Get Channels (public, app-token auth) — creator-entered channel validation:
//      GET https://api.kick.com/public/v1/channels?slug=<slug>
//        headers: Authorization: Bearer <app token>
//        resp.data[]: broadcaster_user_id, slug, stream_title, category,
//                     stream { is_live, viewer_count, start_time, language }
//      Returns the channel EVEN IF offline, so "exists" and "is live" can be
//      answered from one lookup (the basis for validateChannel).
//
// Unlike a throwing provider client this NEVER throws at the public boundary:
// missing creds or any upstream failure degrades to [] + a warning. The secret
// is never logged.
// `category` is passed through as Kick's native name (no invented taxonomy).
// ---------------------------------------------------------------------------

const TOKEN_URL = 'https://id.kick.com/oauth/token';
const API_BASE = 'https://api.kick.com';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_REUSE_SKEW_MS = 60 * 1000;

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

// Map a raw Kick livestream → LiveChannel. No thumbnail is exposed by the public
// livestreams response, so we intentionally leave it empty (the grid renders a
// "no preview" tile) rather than fabricate a URL that may 404 — real-vs-simulated
// visual honesty.
export function normalizeKickStream(raw) {
  const slug = raw.slug || '';
  return makeLiveChannel({
    source: 'kick',
    nativeId: raw.broadcaster_user_id ?? slug,
    title: raw.stream_title,
    channelName: slug,
    channelSlug: slug,
    category: raw.category?.name,
    bucket: bucketForCategory(raw.category?.name),
    viewerCount: raw.viewer_count,
    startedAt: raw.started_at,
    thumbnailUrl: '',
    isLive: true,
    isMature: raw.has_mature_content === true,
    watchUrl: slug ? `https://kick.com/${encodeURIComponent(slug)}` : null,
    language: raw.language,
  });
}

export function createKickClient({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  cacheTtlMs = 45000,
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const hasCreds = () => Boolean(clientId && clientSecret);

  let tokenCache = null;
  let tokenInflight = null;
  let streamsCache = null;
  let streamsInflight = null;

  async function requestAppToken() {
    if (!hasCreds()) throw new ProviderError('MISSING_CREDENTIALS', 'Kick client credentials not configured');
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await safeJson(res);
    if (!res.ok || !json.access_token) {
      // status only — never include the request body / secret.
      throw new ProviderError('HTTP_ERROR', `Kick app token request failed (${res.status})`, { status: res.status });
    }
    const expiresInSec = Number(json.expires_in) || 0;
    tokenCache = {
      accessToken: json.access_token,
      expiresAt: now() + expiresInSec * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return tokenCache.accessToken;
  }

  async function getAppToken() {
    const fresh = tokenCache && tokenCache.expiresAt > now() + TOKEN_REUSE_SKEW_MS;
    if (fresh) return tokenCache.accessToken;
    if (!tokenInflight) {
      tokenInflight = requestAppToken().finally(() => {
        tokenInflight = null;
      });
    }
    return tokenInflight;
  }

  // Internal: throws ProviderError on any failure so tests can assert error paths.
  async function apiGet(pathWithQuery) {
    const accessToken = await getAppToken();
    const res = await fetchImpl(`${API_BASE}${pathWithQuery}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await safeJson(res);
    if (!res.ok) {
      throw new ProviderError('HTTP_ERROR', `Kick request failed (${res.status})`, { status: res.status });
    }
    return json;
  }

  // Public: never throws. Returns LiveChannel[] ([] on any problem). Caches per
  // limit for cacheTtlMs; on failure serves the last good cache (stale fallback).
  async function getTopLiveChannels(limit = 20) {
    if (!hasCreds()) {
      warn('Kick getTopLiveChannels: no credentials → returning empty (demo/fallback mode)');
      return [];
    }
    const first = clampInt(limit, 1, 100, 20);
    const at = now();
    if (streamsCache && streamsCache.key === first && at - streamsCache.at < cacheTtlMs) {
      return streamsCache.data;
    }
    if (!streamsInflight) {
      streamsInflight = (async () => {
        try {
          const json = await apiGet(`/public/v1/livestreams?limit=${first}&sort=viewer_count`);
          const data = (json.data || []).map(normalizeKickStream);
          streamsCache = { key: first, at: now(), data };
          return data;
        } catch (e) {
          warn(`Kick getTopLiveChannels failed → serving ${streamsCache ? 'stale' : 'empty'} (${e.code || e.name})`);
          return streamsCache ? streamsCache.data : [];
        } finally {
          streamsInflight = null;
        }
      })();
    }
    return streamsInflight;
  }

  // Public: never throws. Looks up ONE channel by slug via Get Channels, which
  // returns the channel EVEN IF offline. Returns { slug, isLive, displayName }
  // or null (not found / no creds / request failed).
  async function getChannelBySlug(slug) {
    const norm = String(slug || '').trim().toLowerCase();
    if (!hasCreds() || !norm) return null;
    try {
      const json = await apiGet(`/public/v1/channels?slug=${encodeURIComponent(norm)}`);
      const raw = (json.data || [])[0];
      if (!raw) return null;
      return {
        slug: raw.slug || norm,
        isLive: Boolean(raw.stream?.is_live),
        displayName: raw.display_name || raw.slug || norm,
        // Enrichment for search exact-slug resolution (real values from the Channels
        // response; absent fields stay absent rather than fabricated).
        broadcasterUserId: raw.broadcaster_user_id ?? raw.channel_id ?? null,
        category: raw.category?.name ?? '',
        title: raw.stream_title ?? '',
        viewerCount: raw.stream?.viewer_count ?? null,
        startedAt: raw.stream?.start_time ?? null,
        language: raw.language ?? null,
      };
    } catch (e) {
      warn(`Kick getChannelBySlug failed → returning null (${e.code || e.name})`);
      return null;
    }
  }

  // Public: never throws. Validates a creator-entered channel: exists (even if
  // offline) and whether it's currently live, from ONE Channels lookup.
  // Contract consumed by routes/rooms.js: { slug, exists, isLive, displayName,
  // verifiable }. With no creds we cannot verify → verifiable:false (caller
  // accepts-but-flags, never blocks).
  async function validateChannel(slug) {
    const norm = String(slug || '').trim().toLowerCase();
    if (!norm) return { slug: '', exists: false, isLive: false, verifiable: hasCreds() };
    if (!hasCreds()) {
      return { slug: norm, exists: false, isLive: false, verifiable: false };
    }
    const ch = await getChannelBySlug(norm);
    return {
      slug: norm,
      exists: Boolean(ch),
      isLive: Boolean(ch?.isLive),
      displayName: ch?.displayName || null,
      verifiable: true,
    };
  }

  return {
    hasCreds,
    getTopLiveChannels,
    getChannelBySlug,
    validateChannel,
    // exposed for tests / advanced use; internal, may throw
    _requestAppToken: requestAppToken,
    _getAppToken: getAppToken,
    _tokenCache: () => tokenCache,
  };
}
