import { ProviderError } from '../aggregator/errors.js';
import { makeLiveChannel } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// Kick client — mirrors ../twitch/client.js exactly (single-flight token +
// cache-aside list + stale fallback + never-throws public boundary). Kick's
// official Developer API uses the SAME client-credentials app-token flow as
// Twitch Helix, so the shape is a near-clone with different hosts/fields.
//
// Endpoint shapes verified against the official Kick Developer docs (cited):
//  - App Access Token (client credentials grant):
//      POST https://id.kick.com/oauth/token
//        body (x-www-form-urlencoded): client_id, client_secret, grant_type=client_credentials
//        resp: { access_token, expires_in (seconds), token_type: "Bearer" }
//      (docs.kick.com "Getting an App Access Token"; flow identical to
//       dev.twitch.tv/docs/authentication/getting-tokens-oauth#client-credentials)
//  - Get Livestreams (public, app-token auth):
//      GET https://api.kick.com/public/v1/livestreams?limit=<1..100>&sort=viewer_count
//        headers: Authorization: Bearer <app token>
//        resp.data[]: broadcaster_user_id, slug, stream_title, viewer_count,
//                     started_at, language, has_mature_content,
//                     category { id, name }, custom_tags[]
//
// Like twitch/client.js this NEVER throws at the public boundary: missing creds or
// any upstream failure degrades to [] + a warning. The secret is never logged.
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

  return {
    hasCreds,
    getTopLiveChannels,
    // exposed for tests / advanced use; internal, may throw
    _requestAppToken: requestAppToken,
    _getAppToken: getAppToken,
    _tokenCache: () => tokenCache,
  };
}
