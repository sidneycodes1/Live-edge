import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFootballClient, normalizeFixture } from '../src/football/client.js';
import { createLiveAggregator } from '../src/aggregator/index.js';
import { liveRouter } from '../src/routes/live.js';
import { loadEnv } from '../src/config/env.js';
import { errorHandler } from '../src/middleware/error.js';

// -----------------------------------------------------------------------------
// Football DATA API (Phase 1, docs/football-api.md). Mocked fetch ONLY — never a
// real api-football call. Follows the youtube.test.js mock-fetch contract style
// (injected fetchImpl + makeRes + mockRouter). Every existing test stays intact;
// nothing here weakens/deletes an assertion elsewhere.
//
// Proves: env degrade policy, fixture→item mapping (incl. §4 no-fabricated-viewers),
// cache/TTL/single-flight/budget-guard, stale-on-error vs ProviderError, priority
// league ordering + cap, and the /api/live?category=football envelope WITHOUT letting
// football leak into the generic grid.
// -----------------------------------------------------------------------------

const KEY = 'fa-test-key-do-not-log';
const BASE = 'https://v3.football.api-sports.io';

function makeRes(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, headers: { get: () => null } };
}

function mockRouter(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    for (const r of routes) {
      if (url.includes(r.match)) return typeof r.res === 'function' ? r.res(url, opts) : r.res;
    }
    throw new Error(`unmocked URL: ${url}`);
  };
  return { fn, calls };
}

// A real api-football /fixtures element: only {id,date,status} nest under `fixture`;
// league/teams/goals are TOP-LEVEL siblings.
function fx({
  id,
  league = 'Premier League',
  country = 'England',
  home = 'Arsenal',
  away = 'Chelsea',
  date = '2026-10-03T15:00:00+00:00',
  short = '2H',
  elapsed = 63,
  goalsHome = 1,
  goalsAway = 0,
} = {}) {
  const pre = short === 'NS' || short === 'TBD';
  return {
    fixture: { id, date, status: { long: short, short, elapsed: pre ? null : elapsed } },
    league: { name: league, country },
    teams: { home: { id: 1, name: home }, away: { id: 2, name: away } },
    goals: { home: pre ? null : goalsHome, away: pre ? null : goalsAway },
    score: { halftime: { home: null, away: null }, fulltime: { home: pre ? null : goalsHome, away: pre ? null : goalsAway } },
  };
}

function liveBody(...els) {
  return { response: els };
}

describe('loadEnv — football API degrade policy (STRICT, never crashes boot)', () => {
  it('missing key → disabled (feature off, no boot crash, warning logged)', () => {
    const env = loadEnv({ FOOTBALL_API_PROVIDER: 'api-football', FOOTBALL_API_KEY: '' });
    assert.equal(env.footballApiEnabled, false);
    assert.ok(env.warnings.some((w) => /football data API disabled/i.test(w)));
  });

  it('bad provider → disabled even when a key is present', () => {
    const env = loadEnv({ FOOTBALL_API_PROVIDER: 'someother', FOOTBALL_API_KEY: KEY });
    assert.equal(env.footballApiEnabled, false);
    assert.ok(env.warnings.some((w) => /unsupported/i.test(w)));
  });

  it('provider=api-football + key → enabled', () => {
    const env = loadEnv({ FOOTBALL_API_PROVIDER: 'api-football', FOOTBALL_API_KEY: KEY });
    assert.equal(env.footballApiEnabled, true);
  });

  it('SIM_BET_WINDOW_MIN defaults to 30, accepts a positive int, and falls back (no crash) on garbage', () => {
    assert.equal(loadEnv({}).simBetWindowMin, 30);
    assert.equal(loadEnv({ SIM_BET_WINDOW_MIN: '45' }).simBetWindowMin, 45);
    const bad = loadEnv({ SIM_BET_WINDOW_MIN: 'abc' });
    assert.equal(bad.simBetWindowMin, 30);
    assert.ok(bad.warnings.some((w) => /SIM_BET_WINDOW_MIN/i.test(w)));
    assert.equal(loadEnv({ SIM_BET_WINDOW_MIN: '0' }).simBetWindowMin, 30, '0 is not a positive int → default');
    assert.equal(loadEnv({ SIM_BET_WINDOW_MIN: '12.5' }).simBetWindowMin, 30, 'non-integer → default');
  });
});

describe('normalizeFixture → item shape (docs/football-api.md + §4 honesty)', () => {
  it('live 2H: real elapsed minute, flat goals → score, no viewCount key at all', () => {
    const it = normalizeFixture(fx({ id: 101, short: '2H', elapsed: 78, goalsHome: 2, goalsAway: 1 }));
    assert.equal(it.id, 'match-101');
    assert.equal(it.source, 'football-api');
    assert.equal(it.category, 'Football');
    assert.equal(it.title, 'Arsenal – Chelsea', 'home – away (en dash)');
    assert.equal(it.league, 'Premier League');
    assert.equal(it.country, 'England');
    assert.equal(it.kickOff, '2026-10-03T15:00:00+00:00');
    assert.equal(it.status, '2H');
    assert.equal(it.minute, 78);
    assert.deepEqual(it.score, { home: 2, away: 1 });
    assert.equal(it.videoUrl, null);
    assert.equal(it.thumbnailUrl, null);
    assert.ok(!('viewCount' in it), '§4: no viewer data exists → key must be ABSENT, not 0');
    assert.ok(!('viewerCount' in it), 'and not the LiveChannel alias either');
  });

  it('HT → minute 45; FT → literal "FT"', () => {
    assert.equal(normalizeFixture(fx({ id: 1, short: 'HT', elapsed: 45 })).minute, 45);
    assert.equal(normalizeFixture(fx({ id: 2, short: 'FT' })).minute, 'FT');
    assert.deepEqual(normalizeFixture(fx({ id: 2, short: 'FT', goalsHome: 3, goalsAway: 2 })).score, { home: 3, away: 2 });
  });

  it('pre-kickoff (NS) → minute null AND score null (no fabricated 0-0)', () => {
    const it = normalizeFixture(fx({ id: 3, short: 'NS' }));
    assert.equal(it.minute, null);
    assert.equal(it.score, null, 'pre-match has no score; we never invent 0-0');
    assert.equal(it.status, 'NS');
  });

  it('unknown status (e.g. postponed) → minute null (honest), score null when no goals carried', () => {
    const it = normalizeFixture(fx({ id: 4, short: 'PST', elapsed: null, goalsHome: null, goalsAway: null }));
    assert.equal(it.minute, null);
    assert.equal(it.score, null, 'postponed carries no goals → no fabricated score');
    for (const k of ['id', 'source', 'category', 'title', 'league', 'country', 'kickOff', 'status', 'videoUrl', 'thumbnailUrl']) {
      assert.ok(k in it, `field ${k} must exist`);
    }
  });
});

describe('football client — disabled / credentials (no network)', () => {
  it('missing key → getLiveFixtures throws DISABLED, ZERO fetches', async () => {
    const { fn, calls } = mockRouter([]);
    const c = createFootballClient({ provider: 'api-football', apiKey: '', fetchImpl: fn, warn: () => {} });
    await assert.rejects(() => c.getLiveFixtures(), (e) => e.code === 'DISABLED');
    assert.equal(calls.length, 0);
  });

  it('bad provider → enabled() false and throws DISABLED', async () => {
    const { fn, calls } = mockRouter([]);
    const c = createFootballClient({ provider: 'foo', apiKey: KEY, fetchImpl: fn, warn: () => {} });
    assert.equal(c.enabled(), false);
    await assert.rejects(() => c.getLiveFixtures(), (e) => e.code === 'DISABLED');
    assert.equal(calls.length, 0);
  });

  it('sends x-apisports-key header and the documented ?live=all path', async () => {
    const { fn, calls } = mockRouter([{ match: '/fixtures?live=all', res: makeRes(liveBody(fx({ id: 1 }))) }]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, baseUrl: BASE, fetchImpl: fn });
    await c.getLiveFixtures();
    assert.ok(calls[0].url.startsWith(`${BASE}/fixtures?live=all`), calls[0].url);
    assert.equal(calls[0].headers['x-apisports-key'], KEY);
  });
});

describe('football client — cache TTL, single-flight, HARD budget guard', () => {
  it('second call inside TTL does NOT hit fetch (cache-aside)', async () => {
    let t = 0;
    const { fn, calls } = mockRouter([{ match: '/fixtures?live=all', res: makeRes(liveBody(fx({ id: 1 }))) }]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, fetchImpl: fn, now: () => t });
    await c.getLiveFixtures();
    await c.getLiveFixtures();
    t += 1000;
    await c.getLiveFixtures();
    assert.equal(calls.length, 1, 'all within the 20-min TTL → exactly one network hit');
  });

  it('budget guard: even a cleared/expired cache is NOT refetched while <19min since the last real hit', async () => {
    let t = 0;
    const { fn, calls } = mockRouter([{ match: '/fixtures?live=all', res: makeRes(liveBody(fx({ id: 1 }))) }]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, fetchImpl: fn, now: () => t, liveTtlMs: 1 });
    await c.getLiveFixtures(); // hit at t=0, sets lastLiveFetchAt=0
    t = 18 * 60 * 1000; // 18min later: TTL(1ms) long expired but < 19-min budget guard
    const second = await c.getLiveFixtures();
    assert.equal(calls.length, 1, 'refetch refused inside the budget window (serves cache) → ≤80/day');
    assert.equal(second.stale, false);
    assert.equal(second.items.length, 1);
    t = 19 * 60 * 1000 + 1; // past the guard → a new fetch is allowed
    await c.getLiveFixtures();
    assert.equal(calls.length, 2, 'past 19min → network again');
  });

  it('single-flight: concurrent getLiveFixtures fires ONE request', async () => {
    const { fn, calls } = mockRouter([{ match: '/fixtures?live=all', res: makeRes(liveBody(fx({ id: 1 }))) }]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, fetchImpl: fn });
    const [a, b, d] = await Promise.all([c.getLiveFixtures(), c.getLiveFixtures(), c.getLiveFixtures()]);
    assert.deepEqual(a.items, b.items);
    assert.deepEqual(b.items, d.items);
    assert.equal(calls.length, 1);
  });
});

describe('football client — stale-on-error vs ProviderError', () => {
  it('failure with a cache present → returns stale data flagged stale:true (no throw)', async () => {
    let t = 0;
    let fail = false;
    const { fn } = mockRouter([
      { match: '/fixtures?live=all', res: () => (fail ? makeRes({ error: 'boom' }, { status: 500 }) : makeRes(liveBody(fx({ id: 1 })))) },
    ]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, fetchImpl: fn, now: () => t, warn: () => {} });
    await c.getLiveFixtures();
    fail = true;
    t = 20 * 60 * 1000 + 1; // past BOTH the 19-min guard and the 20-min TTL → a refetch is attempted (and fails)
    const res = await c.getLiveFixtures();
    assert.equal(res.stale, true);
    assert.equal(res.items.length, 1, 'served the last-good fixtures');
    assert.equal(res.items[0].id, 'match-1');
  });

  it('failure with NOTHING cached → throws ProviderError (caller decides fallback)', async () => {
    const { fn } = mockRouter([{ match: '/fixtures?live=all', res: makeRes({ error: 'boom' }, { status: 500 }) }]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, fetchImpl: fn, warn: () => {} });
    await assert.rejects(() => c.getLiveFixtures(), (e) => e.code === 'HTTP_ERROR' && e.status === 500);
  });

  it('HTTP 429 → RATE_LIMIT code', async () => {
    const { fn } = mockRouter([{ match: '/fixtures?live=all', res: makeRes({ error: 'quota' }, { status: 429 }) }]);
    const c = createFootballClient({ provider: 'api-football', apiKey: KEY, fetchImpl: fn, warn: () => {} });
    await assert.rejects(() => c.getLiveFixtures(), (e) => e.code === 'RATE_LIMIT');
  });
});

describe('aggregator.getFootballMatches — priority ordering, cap, honest empty (NO floor ladder)', () => {
  const mkAgg = (football, enabled = { football: true }) =>
    createLiveAggregator({ football, enabled, warn: () => {} });

  it('orders by the priority-league prefix list, others after in stable kickOff order, caps at limit', async () => {
    const items = [
      normalizeFixture(fx({ id: 1, league: 'Some Cup', home: 'A', away: 'B', date: '2026-10-03T10:00:00+00:00' })),
      normalizeFixture(fx({ id: 2, league: 'Premier League', home: 'C', away: 'D', date: '2026-10-03T20:00:00+00:00' })),
      normalizeFixture(fx({ id: 3, league: 'Bundesliga', home: 'E', away: 'F', date: '2026-10-03T09:00:00+00:00' })),
      normalizeFixture(fx({ id: 4, league: 'UEFA Champions League', home: 'G', away: 'H', date: '2026-10-03T21:00:00+00:00' })),
      normalizeFixture(fx({ id: 5, league: 'La Liga', home: 'I', away: 'J', date: '2026-10-03T08:00:00+00:00' })),
    ];
    const football = { getLiveFixtures: async () => ({ items, stale: false }) };
    const agg = mkAgg(football);
    const res = await agg.getFootballMatches(12);
    assert.equal(res.status, 'live');
    assert.deepEqual(
      res.items.map((i) => i.league),
      ['UEFA Champions League', 'Premier League', 'La Liga', 'Bundesliga', 'Some Cup'],
      'priority list order first (UCL>PL>LaLiga>Bundesliga), non-priority last',
    );
    const capped = await agg.getFootballMatches(2);
    assert.equal(capped.items.length, 2);
    assert.deepEqual(capped.items.map((i) => i.id), ['match-4', 'match-2']);
  });

  it('accent-insensitive prefix match (La Liga vs "La Liga" with accents)', async () => {
    const items = [
      normalizeFixture(fx({ id: 1, league: 'Eredivisie', home: 'A', away: 'B' })),
      normalizeFixture(fx({ id: 2, league: 'Ligue 1', home: 'C', away: 'D' })),
    ];
    const res = await mkAgg({ getLiveFixtures: async () => ({ items, stale: false }) }).getFootballMatches(12);
    assert.deepEqual(res.items.map((i) => i.league), ['Ligue 1', 'Eredivisie'], 'Ligue 1 precedes Eredivisie in the priority list');
  });

  it('DISABLED client (no flag) → status disabled, items [] and getLiveFixtures never called', async () => {
    let called = false;
    const football = { getLiveFixtures: async () => { called = true; return { items: [], stale: false }; } };
    const res = await createLiveAggregator({ football, enabled: { football: false }, warn: () => {} }).getFootballMatches(12);
    assert.equal(res.status, 'disabled');
    assert.deepEqual(res.items, []);
    assert.equal(called, false);
  });

  it('enabled but genuinely zero live fixtures → status empty (NOT floor-substituted)', async () => {
    const floor = { getGuaranteedChannel: () => [{ id: 'floor:x', source: 'floor' }] };
    const football = { getLiveFixtures: async () => ({ items: [], stale: false }) };
    const res = await createLiveAggregator({ football, floor, enabled: { football: true }, warn: () => {} }).getFootballMatches(12);
    assert.equal(res.status, 'empty');
    assert.deepEqual(res.items, [], 'the never-empty floor is for the generic grid ONLY');
  });

  it('client throws (nothing cached) → honest empty, floor stand is NOT used', async () => {
    const floor = { getGuaranteedChannel: () => [{ id: 'floor:x', source: 'floor' }] };
    const football = { getLiveFixtures: async () => { const e = new Error('x'); e.code = 'HTTP_ERROR'; throw e; } };
    const res = await createLiveAggregator({ football, floor, enabled: { football: true }, warn: () => {} }).getFootballMatches(12);
    assert.equal(res.status, 'empty');
    assert.deepEqual(res.items, []);
  });

  it('stale client result → status stale', async () => {
    const football = { getLiveFixtures: async () => ({ items: [normalizeFixture(fx({ id: 9 }))], stale: true }) };
    const res = await mkAgg(football).getFootballMatches(12);
    assert.equal(res.status, 'stale');
    assert.equal(res.items.length, 1);
  });
});

// ---- route envelope ----
async function start(aggregatorStub, enabled = {}, warn = () => {}) {
  const app = express();
  app.use('/api/live', liveRouter({ aggregator: aggregatorStub, enabled, warn }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('GET /api/live?category=football — envelope (§3-shaped, sources:["football-api"])', () => {
  it('returns the football envelope with real items, count, servedFrom=live, ISO generatedAt', async () => {
    const items = [normalizeFixture(fx({ id: 1, league: 'Premier League' }))];
    const stub = { getFootballMatches: async () => ({ items, status: 'live', generatedAt: 5 }) };
    const s = await start(stub, { football: true });
    try {
      const res = await fetch(`${s.base}/api/live?category=football&limit=6`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.count, 1);
      assert.equal(json.servedFrom, 'live');
      assert.deepEqual(json.sources, ['football-api']);
      assert.equal(new Date(json.generatedAt).getTime(), 5);
      assert.equal(json.items[0].id, 'match-1');
      assert.ok(!('viewCount' in json.items[0]), 'no fabricated viewCount crosses the wire');
    } finally { await s.close(); }
  });

  it('disabled client → items [] honestly and servedFrom=disabled (no floor substitution)', async () => {
    const stub = { getFootballMatches: async () => ({ items: [], status: 'disabled', generatedAt: 1 }) };
    const s = await start(stub, {});
    try {
      const json = await (await fetch(`${s.base}/api/live?category=football`)).json();
      assert.equal(json.servedFrom, 'disabled');
      assert.deepEqual(json.items, []);
      assert.equal(json.count, 0);
      assert.deepEqual(json.sources, ['football-api']);
    } finally { await s.close(); }
  });

  it('maps stale→servedFrom=stale and empty→servedFrom=empty', async () => {
    const st = { getFootballMatches: async () => ({ items: [normalizeFixture(fx({ id: 2 }))], status: 'stale', generatedAt: 1 }) };
    const s1 = await start(st, { football: true });
    try {
      assert.equal((await (await fetch(`${s1.base}/api/live?category=football`)).json()).servedFrom, 'stale');
    } finally { await s1.close(); }

    const em = { getFootballMatches: async () => ({ items: [], status: 'empty', generatedAt: 1 }) };
    const s2 = await start(em, { football: true });
    try {
      assert.equal((await (await fetch(`${s2.base}/api/live?category=football`)).json()).servedFrom, 'empty');
    } finally { await s2.close(); }
  });

  it('an aggregator crash → never 500, honest empty football feed', async () => {
    const warns = [];
    const stub = { getFootballMatches: async () => { throw new Error('boom'); } };
    const s = await start(stub, { football: true }, (m) => warns.push(m));
    try {
      const res = await fetch(`${s.base}/api/live?category=football`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.count, 0);
      assert.equal(json.servedFrom, 'empty');
      assert.ok(warns.some((w) => /football feed threw/i.test(w)));
    } finally { await s.close(); }
  });

  it('football items do NOT leak into the generic (no-category) feed', async () => {
    let footballCalled = false;
    const stub = {
      getChannels: async () => ({ items: [{ id: 'twitch:1', source: 'twitch', viewerCount: 3 }], sources: { twitch: 1 }, degraded: [], usedStale: false, usedFloor: false, generatedAt: 1 }),
      getFootballMatches: async () => { footballCalled = true; return { items: [], status: 'live' }; },
    };
    const s = await start(stub, { twitch: true });
    try {
      const json = await (await fetch(`${s.base}/api/live`)).json();
      assert.equal(footballCalled, false, 'generic feed must not invoke the football data path');
      assert.equal(json.items[0].source, 'twitch');
      // §3 generic sources object (four keys) — NOT the football array.
      assert.deepEqual(Object.keys(json.sources), ['twitch', 'kick', 'youtube', 'floor']);
    } finally { await s.close(); }
  });
});
