import { TwitchError } from './errors.js';

// ---------------------------------------------------------------------------
// Twitch Helix client (Phase A — foundation, nothing user-facing yet).
//
// Endpoint shapes verified against the OFFICIAL docs on this branch (cited):
//  - App Access Token (client credentials grant):
//      https://dev.twitch.tv/docs/authentication/getting-tokens-oauth#client-credentials-grant-flow
//      POST https://id.twitch.tv/oauth2/token
//        body (x-www-form-urlencoded): client_id, client_secret, grant_type=client_credentials
//        resp: { access_token, expires_in (seconds), token_type: "bearer" }
//      We honor the returned expires_in (app tokens are long-lived — value varies);
//      we never assume a fixed TTL. Refresh a few minutes before expiry.
//  - Get Streams:
//      https://dev.twitch.tv/docs/api/reference#get-streams
//      GET https://api.twitch.tv/helix/streams?first=<1..100>&type=live[&user_login=<login>]
//        headers: Client-Id, Authorization: Bearer <app token>
//        resp.data[]: id, user_id, user_login, user_name, game_id, game_name,
//                     type, title, tags, viewer_count, started_at, language,
//                     thumbnail_url ("...{width}x{height}.jpg"), is_mature
//      pagination.cursor for paging.
//
// Like ../panta/hybrid.js, this NEVER throws uncaught at the public boundary:
// missing creds or any upstream failure degrades to an empty/null result + a
// warning log. The secret is never logged.
// ---------------------------------------------------------------------------

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_BASE = 'https://api.twitch.tv';

// Refresh this much before the token's real expiry (safety margin), and treat a
// token expiring within this window as already-stale when reusing from cache.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_REUSE_SKEW_MS = 60 * 1000;

// Warn when Helix Ratelimit-Remaining drops below this (per docs, responses carry
// Ratelimit-Limit / Ratelimit-Remaining / Ratelimit-Reset).
const RATE_WARN_FLOOR = 10;

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Replace the {width}/{height} placeholders in a Helix thumbnail_url template
// (docs: "Replace the width and height placeholders ... with the size ... you want").
export function fillThumbnail(url, width, height) {
  if (!url) return '';
  return url
    .replaceAll('{width}', String(width))
    .replaceAll('{height}', String(height))
    .replaceAll('{frame}', '1');
}

function normalizeStream(raw, { previewWidth, previewHeight }) {
  return {
    id: raw.id,
    userId: raw.user_id,
    userLogin: raw.user_login,
    userName: raw.user_name,
    title: raw.title || '',
    gameName: raw.game_name || '',
    viewerCount: Number(raw.viewer_count) || 0,
    startedAt: raw.started_at,
    language: raw.language,
    thumbnailUrl: fillThumbnail(raw.thumbnail_url, previewWidth, previewHeight),
    isMature: raw.is_mature === true,
  };
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

export function createTwitchClient({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  cacheTtlMs = 45000,
  previewWidth = 320,
  previewHeight = 180,
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const hasCreds = () => Boolean(clientId && clientSecret);

  // In-memory token cache: { accessToken, expiresAt }. Single-flight via tokenInflight.
  let tokenCache = null;
  let tokenInflight = null;

  // Short server-side cache for getTopLiveStreams, keyed by limit, so Discover
  // page loads don't hammer Helix. { key, at, data }
  let streamsCache = null;
  let streamsInflight = null;

  async function requestAppToken() {
    if (!hasCreds()) throw new TwitchError('MISSING_CREDENTIALS', 'Twitch client credentials not configured');
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
      // status only — never include the request body / secret in the message.
      throw new TwitchError('TOKEN_FAILED', `Twitch app token request failed (${res.status})`, { status: res.status });
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

  function checkRateLimit(res) {
    try {
      const remaining = Number(res.headers?.get?.('Ratelimit-Remaining'));
      if (Number.isFinite(remaining) && remaining < RATE_WARN_FLOOR) {
        warn(`Twitch Helix rate limit low (Ratelimit-Remaining=${remaining})`);
      }
    } catch {
      // header absent / not readable — ignore, purely advisory
    }
  }

  // Internal: throws TwitchError on any failure so tests can assert error paths.
  async function helixGet(pathWithQuery) {
    const accessToken = await getAppToken();
    const res = await fetchImpl(`${HELIX_BASE}${pathWithQuery}`, {
      method: 'GET',
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    checkRateLimit(res);
    const json = await safeJson(res);
    if (!res.ok) {
      throw new TwitchError('HELIX_ERROR', `Twitch Helix request failed (${res.status})`, { status: res.status });
    }
    return json;
  }

  // Public: never throws. Returns [] + warns on any problem (missing creds,
  // token failure, upstream error, empty). Caches per limit for cacheTtlMs.
  async function getTopLiveStreams(limit = 20) {
    if (!hasCreds()) {
      warn('Twitch getTopLiveStreams: no credentials → returning empty (demo/fallback mode)');
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
          const json = await helixGet(`/helix/streams?first=${first}&type=live`);
          const data = (json.data || []).map((s) => normalizeStream(s, { previewWidth, previewHeight }));
          streamsCache = { key: first, at: now(), data };
          return data;
        } catch (e) {
          warn(`Twitch getTopLiveStreams failed → returning empty (${e.code || e.name})`);
          // Keep serving a stale-but-usable cache if we have one; otherwise empty.
          return streamsCache ? streamsCache.data : [];
        } finally {
          streamsInflight = null;
        }
      })();
    }
    return streamsInflight;
  }

  // Public: never throws. Returns the single live stream for a login, or null if
  // the channel is offline / not found / creds missing / request failed.
  // Docs: Get Streams with user_login "If the user is not live, the response doesn't
  // include them." (https://dev.twitch.tv/docs/api/reference#get-streams)
  async function getStreamByLogin(login) {
    if (!hasCreds()) {
      warn('Twitch getStreamByLogin: no credentials → returning null (demo/fallback mode)');
      return null;
    }
    if (!login) return null;
    try {
      const json = await helixGet(`/helix/streams?user_login=${encodeURIComponent(String(login).toLowerCase())}&type=live`);
      const raw = (json.data || [])[0];
      return raw ? normalizeStream(raw, { previewWidth, previewHeight }) : null;
    } catch (e) {
      warn(`Twitch getStreamByLogin failed → returning null (${e.code || e.name})`);
      return null;
    }
  }

  return {
    hasCreds,
    getTopLiveStreams,
    getStreamByLogin,
    // exposed for tests / advanced use; internal, may throw
    _requestAppToken: requestAppToken,
    _getAppToken: getAppToken,
    _tokenCache: () => tokenCache,
  };
}
