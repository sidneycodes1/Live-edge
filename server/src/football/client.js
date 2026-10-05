import { ProviderError } from '../aggregator/errors.js';

// ---------------------------------------------------------------------------
// API-Football DATA client — Phase 1 of the Football Live Bets overhaul.
//
// This is a SPORTS-DATA source, not a live-video provider: it tells us which
// matches are live right now, the minute, and the score. Video/thumbnail attach
// is a later phase, so those fields stay null here. The client mirrors the
// public-boundary shape of ../youtube/client.js (cache-aside + stale fallback +
// single-flight) but adds a HARD daily-budget guard because the free plan is
// metered (100 requests/day) — see the budget notes on each cache below.
//
// Endpoints (docs: https://www.api-football.com/documentation-v3):
//   GET {base}/fixtures?live=all     → response[] of { fixture, league, teams, goals, score }
//   GET {base}/fixtures?date=YYYY-MM-DD
// Auth: header  x-apisports-key: <FOOTBALL_API_KEY>  (NEVER logged/echoed).
//
// Error model is IDENTICAL to the YouTube client (../aggregator/errors.js
// ProviderError) so callers classify failures the same way:
//   DISABLED          client not configured (bad provider / missing key) → throws, no network
//   TIMEOUT           request exceeded `timeoutMs` (AbortController) — retryable upstream
//   RATE_LIMIT        HTTP 429 (metered plan out of budget)
//   HTTP_ERROR        any other non-2xx; `.status` carries the code
//   NETWORK           transport threw
// Unlike the video clients, the PUBLIC methods here MAY throw (DISABLED / hard
// failure with nothing cached): the aggregator (caller) decides the fallback. On a
// transient failure WITH a stale cache available the method returns that data
// flagged `stale:true` instead of throwing.
//
// §4 honesty: the normalized item carries ONLY real provider fields. We never set
// a viewerCount (there is none) — the key is ABSENT, not 0. Thumbnails/urls we do
// not have stay null.
// ---------------------------------------------------------------------------

// Fixtures are a bespoke shape (NOT a LiveChannel): forcing them through
// makeLiveChannel would clamp `source` (unknown to LIVE_SOURCES) to '' and inject a
// fabricated viewerCount 0. So we build the exact object the brief mandates.
//
// api-football's /fixtures response nests only { id, date, status } under `fixture`
// while league/teams/goals/score are TOP-LEVEL siblings. We read BOTH layouts
// (elem.X then elem.fixture.X) so the real payload and a flattened fixture work alike.
export function normalizeFixture(elem) {
  const e = elem || {};
  const f = e.fixture || e;
  const status = (f?.status ?? e?.status)?.short ?? null;
  const elapsed = (f?.status ?? e?.status)?.elapsed;

  // minute: live periods report elapsed; HT pins to 45; FT is the literal 'FT';
  // everything else (NS / TBD / postponed / etc) is honestly null.
  let minute = null;
  if (status === '1H' || status === '2H') {
    minute = Number.isFinite(elapsed) ? elapsed : null;
  } else if (status === 'HT') {
    minute = 45;
  } else if (status === 'FT') {
    minute = 'FT';
  }

  // Pre-kickoff → no score. `goals` is the flat {home, away} current score; some
  // payloads only carry score.fulltime — fall back to it when goals is absent.
  const preKickoff = status === 'NS' || status === 'TBD';
  const goals = e.goals ?? f.goals ?? e.score?.fulltime ?? f.score?.fulltime;
  let score = null;
  if (!preKickoff && goals && (goals.home != null || goals.away != null)) {
    score = { home: goals.home, away: goals.away };
  }

  const league = e.league ?? f.league ?? {};
  const teams = e.teams ?? f.teams ?? {};
  const home = teams?.home?.name ?? '';
  const away = teams?.away?.name ?? '';
  const id = f?.id ?? e?.id;

  // NOTE: no `viewCount` key at all (§4: we have no viewer data — never fabricate).
  return {
    id: id == null ? '' : `match-${id}`,
    source: 'football-api',
    category: 'Football',
    title: home && away ? `${home} \u2013 ${away}` : (home || away || ''),
    league: league?.name ?? '',
    country: league?.country ?? '',
    kickOff: f?.date ?? e?.date ?? null,
    status,
    minute,
    score,
    videoUrl: null,
    thumbnailUrl: null,
  };
}

// Whole-match dedupe key so a fixture surfaced by more than one query is counted once.
function fixtureKey(item) {
  return item.id || item.kickOff + '|' + item.title;
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

export function createFootballClient({
  provider,
  apiKey,
  baseUrl = 'https://v3.football.api-sports.io',
  fetchImpl = fetch,
  timeoutMs = 8000,
  // Budget math (free plan = 100 req/day): live TTL 20min ⇒ ≤72/day; a 19-min hard
  // guard caps refetch even if the cache was cleared ⇒ ≤75/day (≤ 80 as required).
  // Today TTL 6h ⇒ ≤4/day (≤ 8 as required).
  liveTtlMs = 20 * 60 * 1000,
  budgetGuardMs = 19 * 60 * 1000,
  todayTtlMs = 6 * 60 * 60 * 1000,
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const enabled = () => provider === 'api-football' && Boolean(apiKey);

  let liveCache = null; // { at, items } — last-good live fixtures
  let liveInflight = null;
  let lastLiveFetchAt = null; // stamp of the last REAL network hit (budget guard)

  // Today-list is keyed by date so a same-day refetch is cached per calendar day.
  const todayCache = new Map(); // date -> { at, items }
  const todayInflight = new Map(); // date -> Promise

  async function apiGet(queryString) {
    if (!enabled()) throw new ProviderError('DISABLED', 'football data API not configured');
    const url = `${baseUrl}${queryString}`;
    let ctrl;
    let timer;
    try {
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      timer = setTimeout(() => ctrl?.abort?.(), timeoutMs);
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: { 'x-apisports-key': apiKey },
        signal: ctrl?.signal,
      });
      const json = await safeJson(res);
      if (res.status === 429) throw new ProviderError('RATE_LIMIT', 'football API rate limited (429)', { status: 429 });
      if (!res.ok) throw new ProviderError('HTTP_ERROR', `football API request failed (${res.status})`, { status: res.status });
      return json;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      // An abort rejects with an AbortError; classify it as TIMEOUT for parity.
      if (e?.name === 'AbortError') throw new ProviderError('TIMEOUT', `football API request timed out (${timeoutMs}ms)`);
      throw new ProviderError('NETWORK', `football API transport error (${e?.code || e?.name || 'ERROR'})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function toItems(json) {
    const rows = Array.isArray(json?.response) ? json.response : [];
    const seen = new Set();
    const items = [];
    for (const el of rows) {
      const it = normalizeFixture(el);
      if (!it.id) continue;
      const k = fixtureKey(it);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }
    return items;
  }

  // Internal live fetch — throws so callers/tests can assert failure paths.
  async function fetchLive() {
    const json = await apiGet('/fixtures?live=all');
    return toItems(json);
  }

  // Public: never returns a partial on failure — either fresh/stale data or a throw.
  // { items, stale }. Throws DISABLED when unconfigured; throws the underlying code
  // on failure with nothing cached (caller decides fallback).
  async function getLiveFixtures() {
    if (!enabled()) {
      warn('football client: not configured (bad provider or missing key) → disabled, no network');
      throw new ProviderError('DISABLED', 'football data API not configured');
    }
    const at = now();

    // HARD budget guard: refuse a new live network hit while the last one is <19min
    // old — serve the cache even if it has aged past TTL. This is what keeps us ≤80/day.
    if (liveCache && lastLiveFetchAt != null && at - lastLiveFetchAt < budgetGuardMs) {
      return { items: liveCache.items, stale: false };
    }
    // Normal fresh path.
    if (liveCache && at - liveCache.at < liveTtlMs) {
      return { items: liveCache.items, stale: false };
    }
    // Single-flight: concurrent callers share the one in-flight request.
    if (liveInflight) return liveInflight;

    liveInflight = (async () => {
      try {
        const items = await fetchLive();
        liveCache = { at: now(), items };
        lastLiveFetchAt = now();
        return { items, stale: false };
      } catch (e) {
        if (e.code === 'DISABLED') throw e;
        if (liveCache) {
          warn(`football client: live fetch failed → serving stale cache (${e.code || e.name})`);
          return { items: liveCache.items, stale: true };
        }
        warn(`football client: live fetch failed and nothing cached → throwing (${e.code || e.name})`);
        throw e;
      } finally {
        liveInflight = null;
      }
    })();
    return liveInflight;
  }

  // Today list, cached 6h per date. Throws on failure with nothing cached; there is
  // no stale fallback here (a different date's list is not a valid stale answer).
  async function getTodayFixtures(date) {
    if (!enabled()) {
      warn('football client: not configured → disabled, no network');
      throw new ProviderError('DISABLED', 'football data API not configured');
    }
    const day = String(date || '').slice(0, 10);
    const at = now();
    const cached = todayCache.get(day);
    if (cached && at - cached.at < todayTtlMs) return { items: cached.items, stale: false };
    if (todayInflight.has(day)) return todayInflight.get(day);

    const p = (async () => {
      try {
        const json = await apiGet(`/fixtures?date=${encodeURIComponent(day)}`);
        const items = toItems(json);
        todayCache.set(day, { at: now(), items });
        return { items, stale: false };
      } finally {
        todayInflight.delete(day);
      }
    })();
    todayInflight.set(day, p);
    return p;
  }

  return {
    enabled,
    getLiveFixtures,
    getTodayFixtures,
  };
}
