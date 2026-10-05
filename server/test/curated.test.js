import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  createCuratedClient,
  parseFirstEntry,
  normalizeCuratedItem,
  decodeEntities,
} from '../src/curated/client.js';
import { CURATED_CHANNELS } from '../src/curated/channels.js';
import { createLiveAggregator } from '../src/aggregator/index.js';
import { makeLiveChannel, LIVE_SOURCES } from '../src/aggregator/schema.js';
import { liveRouter } from '../src/routes/live.js';
import { loadEnv } from '../src/config/env.js';

// -----------------------------------------------------------------------------
// Phase 2 — Curated always-live channel source (quota-free) + Gemini env
// groundwork. MOCKED fetch ONLY; RSS XML fixtures are inline; NOTHING here hits
// the network. Add-only: no existing assertion is weakened or removed.
//
// Covers the frozen contracts:
//   • §4 honesty — a curated item carries NO viewCount key (never fabricated).
//   • item mapping — exact fields, liveEmbedUrl built from CHANNEL id.
//   • client resilience — per-channel skip, all-fail → ProviderError('NETWORK'),
//     10-min cache + single-flight.
//   • aggregator merge — real providers FIRST, curated fills to ≥12, dedupe by
//     video id, floor ladder unchanged, §3 wire `sources` keys stay exactly 4.
//   • env — GEMINI absent → disabled; model defaults to gemini-3.8-flash.
// ---------------------------------------------------------------------------

// ---- helpers ---------------------------------------------------------------

// Build a minimal Atom feed with the fields the client actually parses.
function rss(videoId, title, author) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <id>http://www.youtube.com/feeds/videos.xml/channel/CHAN</id>
  <title>Feed Level Channel Title</title>
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <title>${title}</title>
    <author><name>${author}</name></author>
  </entry>
</feed>`;
}

function makeRes(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, headers: { get: () => null } };
}

// Route RSS fetches by channel_id query param. `byId` maps channelId → a
// resolver (res object) or a function(url) → res/throw. Unlisted → 404.
function mockRss(byId) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const cid = new URL(url).searchParams.get('channel_id');
    const r = byId[cid];
    if (r === undefined) return makeRes('not found', { status: 404 });
    return typeof r === 'function' ? r(url) : r;
  };
  return { fn, calls };
}

const CHANNELS = [
  { channelId: 'UCnews1', name: 'News One', category: 'News' },
  { channelId: 'UCsport2', name: 'Sport Two', category: 'Sports' },
  { channelId: 'UCmusic3', name: 'Music Three', category: 'Music/Ambience' },
];

const quiet = { warn: () => {} };

// ---- parse + item mapping --------------------------------------------------

describe('curated RSS parse + item mapping (spec §1/§4)', () => {
  it('parseFirstEntry extracts videoId, title, authorName from the latest <entry>', () => {
    const e = parseFirstEntry(rss('abc123XY_-', 'Lofi radio — beats to relax', 'Lofi Girl'));
    assert.deepEqual(e, { videoId: 'abc123XY_-', title: 'Lofi radio — beats to relax', authorName: 'Lofi Girl' });
  });

  it('parseFirstEntry falls back to <id>yt:video:… when <yt:videoId> is absent', () => {
    const xml = '<feed><entry><id>yt:video:ZZ9-__aa</id><title>T</title><author><name>A</name></author></entry></feed>';
    assert.equal(parseFirstEntry(xml).videoId, 'ZZ9-__aa');
  });

  it('parseFirstEntry returns null for an entry-less feed', () => {
    assert.equal(parseFirstEntry('<feed><title>no entries</title></feed>'), null);
  });

  it('decodeEntities unescapes XML entities and resolves &amp; LAST (no double-unescape)', () => {
    assert.equal(decodeEntities('A &amp; B'), 'A & B');
    assert.equal(decodeEntities('&lt;live&gt;'), '<live>');
    assert.equal(decodeEntities('&#39;quoted&#39;'), "'quoted'");
    assert.equal(decodeEntities('&#x27;'), "'");
    assert.equal(decodeEntities('&amp;lt;'), '&lt;', 'literal &amp;lt; must NOT become < after one pass');
  });

  it('normalizeCuratedItem builds the EXACT §1/§4 shape — no viewCount key, liveEmbedUrl by CHANNEL id', () => {
    const ch = { channelId: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl', category: 'Music/Ambience' };
    const it = normalizeCuratedItem(ch, { videoId: 'vidLIVE', title: 'lofi hip hop radio', authorName: 'Lofi Girl' });
    assert.equal(it.id, 'yt-vidLIVE');
    assert.equal(it.source, 'curated-youtube');
    assert.equal(it.category, 'Music/Ambience');
    assert.equal(it.title, 'lofi hip hop radio');
    assert.equal(it.channelName, 'Lofi Girl');
    assert.equal(it.owner, 'Lofi Girl');
    assert.equal(it.videoUrl, 'https://www.youtube.com/watch?v=vidLIVE');
    assert.equal(it.liveEmbedUrl, 'https://www.youtube.com/embed/live_stream?channel=UCSJ4gkVC6NrvII8umztf0Ow');
    assert.equal(it.thumbnailUrl, 'https://i.ytimg.com/vi/vidLIVE/hqdefault.jpg');
    assert.equal(it.status, 'live-24-7');
    // §4: we have no concurrent-viewer figure, so the key must be ABSENT (not 0).
    assert.ok(!('viewCount' in it), 'viewCount key must NOT exist on a curated item');
    assert.ok(!('viewerCount' in it), 'no viewer count of any kind (§4 honesty)');
  });

  it('channelName falls back to the curated name when the feed author is missing', () => {
    const it = normalizeCuratedItem({ channelId: 'UC1', name: 'Fallback FM', category: 'News' }, { videoId: 'v', title: 't', authorName: '' });
    assert.equal(it.channelName, 'Fallback FM');
  });
});

// ---- curated channels list -------------------------------------------------

describe('CURATED_CHANNELS — the verified always-live set', () => {
  it('has ≥12 entries, includes every documented seed id, and a { channelId, name, category } shape', () => {
    assert.ok(CURATED_CHANNELS.length >= 12, 'curated alone must be able to reach the ≥12 goal (one item per channel)');
    const ids = new Set(CURATED_CHANNELS.map((c) => c.channelId));
    for (const id of [
      'UCNye-wNBqNL5ZzHSJj3l8Bg', 'UCCCPCZNChQdGa9EkATeye4g', 'UCknLrEdhRCp1aegoMqRaCZg',
      'UCoMdktPbSTixAyNGwb-UYkQ', 'UCVgO39Bk5sMo66-6o6Spn6Q', 'UC7fWeaHhqgM4Ry-RMpM2YYw',
      'UCb--64Gl51jIEVE-GLDAVTg', 'UCcw05gGzjLIs5dnxGkQHMvw', 'UClhp9g6TPiqCTOlcw0ROfNg',
      'UCSJ4gkVC6NrvII8umztf0Ow',
    ]) {
      assert.ok(ids.has(id), `expected curated id ${id}`);
    }
    for (const c of CURATED_CHANNELS) {
      assert.ok(c.channelId && c.name && c.category, 'each entry needs channelId, name, category');
    }
  });
});

// ---- client resilience -----------------------------------------------------

describe('curated client — parallel fetch, skip, all-fail, cache, single-flight', () => {
  it('happy path: maps every live feed into the §1/§4 item shape (no viewCount)', async () => {
    const { fn } = mockRss({
      UCnews1: makeRes(rss('v1', 'News live', 'News One')),
      UCsport2: makeRes(rss('v2', 'Sport live', 'Sport Two')),
      UCmusic3: makeRes(rss('v3', 'Music live', 'Music Three')),
    });
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, ...quiet });
    const items = await c.getChannels();
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((i) => i.id), ['yt-v1', 'yt-v2', 'yt-v3']);
    assert.ok(items.every((i) => !('viewCount' in i)));
    assert.equal(items[0].liveEmbedUrl, 'https://www.youtube.com/embed/live_stream?channel=UCnews1');
  });

  it('per-channel failure is SKIPPED (partial results fine) and logged', async () => {
    const warns = [];
    const { fn } = mockRss({
      UCnews1: makeRes(rss('v1', 'News live', 'News One')),
      UCsport2: () => { throw new Error('transport down'); }, // this channel fails
      UCmusic3: makeRes(rss('v3', 'Music live', 'Music Three')),
    });
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, warn: (m) => warns.push(m) });
    const items = await c.getChannels();
    assert.deepEqual(items.map((i) => i.id), ['yt-v1', 'yt-v3'], 'the failed channel is dropped, siblings survive');
    assert.ok(warns.some((w) => /Sport Two/.test(w)), 'which channel failed is logged');
  });

  it('a 404 feed is treated as dead and dropped (never ship a card we cannot load)', async () => {
    const { fn } = mockRss({ UCnews1: makeRes(rss('v1', 't', 'a')), UCsport2: makeRes('gone', { status: 404 }) });
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, ...quiet });
    const items = await c.getChannels();
    assert.deepEqual(items.map((i) => i.id), ['yt-v1'], 'UCmusic3 (unmocked→404) and UCsport2 (404) dropped');
  });

  it('EVERY feed failing with no cache → ProviderError(NETWORK)', async () => {
    const { fn } = mockRss({}); // all resolve to 404 → each fetchFeed throws
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, ...quiet });
    await assert.rejects(() => c.getChannels(), (err) => err.code === 'NETWORK', 'total outage surfaces NETWORK');
  });

  it('caches within TTL (one RSS batch) and refetches past the 10-minute window', async () => {
    let t = 0;
    const { fn, calls } = mockRss({
      UCnews1: makeRes(rss('v1', 'a', 'b')), UCsport2: makeRes(rss('v2', 'a', 'b')), UCmusic3: makeRes(rss('v3', 'a', 'b')),
    });
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, now: () => t, ttlMs: 600000, ...quiet });
    await c.getChannels();
    await c.getChannels();
    assert.equal(calls.length, 3, 'within TTL → exactly one parallel batch (3 feeds)');
    t += 600001;
    await c.getChannels();
    assert.equal(calls.length, 6, 'past TTL → a fresh batch');
  });

  it('serves stale cache when a later refresh fully fails (instead of throwing)', async () => {
    let t = 0;
    let fail = false;
    const good = { UCnews1: makeRes(rss('v1', 'a', 'b')), UCsport2: makeRes(rss('v2', 'a', 'b')), UCmusic3: makeRes(rss('v3', 'a', 'b')) };
    const fn = async (url) => {
      if (fail) throw new Error('down');
      const cid = new URL(url).searchParams.get('channel_id');
      return good[cid] || makeRes('no', { status: 404 });
    };
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, now: () => t, ttlMs: 600000, ...quiet });
    const first = await c.getChannels();
    assert.equal(first.length, 3);
    fail = true;
    t += 600001;
    const second = await c.getChannels();
    assert.deepEqual(second.map((i) => i.id), first.map((i) => i.id), 'failed refresh → last-good cache served, not a throw');
  });

  it('single-flight: concurrent getChannels fires ONE RSS batch', async () => {
    const { fn, calls } = mockRss({
      UCnews1: makeRes(rss('v1', 'a', 'b')), UCsport2: makeRes(rss('v2', 'a', 'b')), UCmusic3: makeRes(rss('v3', 'a', 'b')),
    });
    const c = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, ...quiet });
    const [a, b, d] = await Promise.all([c.getChannels(), c.getChannels(), c.getChannels()]);
    assert.deepEqual(a, b);
    assert.deepEqual(b, d);
    assert.equal(calls.length, 3, 'three concurrent callers → one batch of 3 feeds, not 9');
  });
});

// ---- aggregator merge ------------------------------------------------------

const live = (source, id, viewerCount) => makeLiveChannel({ source, nativeId: id, viewerCount, title: `${source}-${id}` });
const curatedItem = (vid, category = 'News') => normalizeCuratedItem({ channelId: `UC-${vid}`, name: `Curated ${vid}`, category }, { videoId: vid, title: `curated ${vid}`, authorName: `Curated ${vid}` });

describe('aggregator — curated post-merge fill (Phase 2)', () => {
  it('providers come FIRST, curated APPENDS to reach ≥12 (never exceeding limit)', async () => {
    const kickItems = [live('kick', 'k1', 5000), live('kick', 'k2', 4000)];
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [] },
      kick: { getTopLiveChannels: async () => kickItems },
      youtube: { getTopLiveChannels: async () => [] },
      floor: { getGuaranteedChannel: () => [] },
      curated: { getChannels: async () => Array.from({ length: 10 }, (_, i) => curatedItem(`c${i}`)) },
      enabled: { twitch: true, kick: true, youtube: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(r.items.length, 12, '2 real + curated fill to the ≥12 goal');
    assert.equal(r.items[0].id, 'kick:k1', 'provider result keeps the top slot');
    assert.equal(r.items[1].id, 'kick:k2');
    assert.equal(r.items[2].source, 'curated-youtube', 'curated appended after providers');
    assert.equal(r.sources.curated, 10);
    assert.equal(r.usedStale, false);
    assert.equal(r.usedFloor, false);
  });

  it('curated fills the grid even when EVERY live provider returns empty (search quota dead)', async () => {
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [] },
      kick: { getTopLiveChannels: async () => [] },
      youtube: { getTopLiveChannels: async () => [] },
      floor: { getGuaranteedChannel: () => [] },
      curated: { getChannels: async () => Array.from({ length: 10 }, (_, i) => curatedItem(`c${i}`)) },
      enabled: { twitch: true, kick: true, youtube: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(r.items.length, 10, '10 curated items carry the grid when live sources are empty');
    assert.ok(r.items.every((i) => i.source === 'curated-youtube'));
    assert.equal(r.usedFloor, false, 'curated short-circuits the ladder — the config floor stays a last resort');
  });

  it('dedupes curated against providers BY VIDEO ID across the yt-/youtube: namespaces', async () => {
    const yt = [live('youtube', 'dup', 9000)];
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [] },
      youtube: { getTopLiveChannels: async () => yt },
      floor: { getGuaranteedChannel: () => [] },
      // curated repeats the same video id 'dup' plus two new ones
      curated: { getChannels: async () => [curatedItem('dup'), curatedItem('n1'), curatedItem('n2')] },
      enabled: { twitch: true, youtube: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    const vids = r.items.map((i) => i.id);
    assert.ok(vids.includes('youtube:dup'));
    assert.ok(!vids.includes('yt-dup'), 'yt-dup deduped against youtube:dup by bare video id');
    assert.equal(r.items.length, 3, 'youtube:dup + 2 new curated');
  });

  it('curated FAILURE never breaks the grid (degraded, floor ladder still runs)', async () => {
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [] },
      floor: { getTopLiveChannels: async () => [], getGuaranteedChannel: () => [live('floor', 'guar', 0)] },
      curated: { getChannels: async () => { const e = new Error('rss down'); e.code = 'NETWORK'; throw e; } },
      enabled: { twitch: true, floor: true },
      resilience: { retries: 0, curatedTimeoutMs: 5000 },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.ok(r.degraded.some((d) => d.source === 'curated'), 'curated reported degraded');
    assert.equal(r.usedFloor, true, 'with providers empty AND curated down, the floor ladder still fires');
    assert.equal(r.items[0].id, 'floor:guar');
  });

  it('when NO curated client is wired, getChannels behaves exactly as before (additive-safe)', async () => {
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [] },
      kick: { getTopLiveChannels: async () => [live('kick', 'k1', 1)] },
      floor: { getGuaranteedChannel: () => [] },
      enabled: { twitch: true, kick: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(r.items.length, 1);
    assert.ok(!('curated' in r.sources), 'no curated key when the client is absent');
  });

  it('football items NEVER enter the general grid (unchanged phase rule)', async () => {
    let footballTouched = false;
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [] },
      floor: { getGuaranteedChannel: () => [] },
      football: { getLiveFixtures: async () => { footballTouched = true; return { items: [{ id: 'fb-1', source: 'football-api' }], stale: false }; } },
      curated: { getChannels: async () => [curatedItem('c1')] },
      enabled: { twitch: true, floor: true, football: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(footballTouched, false, 'getChannels must not call the football data client');
    assert.ok(!r.items.some((i) => i.source === 'football-api'));
    assert.ok(!agg.providers.includes('football'), 'football is not a grid provider');
  });

  it('§3 wire contract UNCHANGED: the HTTP `sources` object still has exactly the 4 LIVE_SOURCES keys', async () => {
    // The aggregator records an internal `sources.curated`, but the route builds its
    // wire payload strictly from LIVE_SOURCES — so §3 consumers see no new key.
    const stub = {
      getChannels: async () => ({
        items: [{ id: 'kick:k1', source: 'kick', viewerCount: 1 }, curatedItem('c9')],
        sources: { twitch: 0, kick: 1, youtube: 0, floor: 0, curated: 1 },
        degraded: [{ source: 'curated', reason: 'NETWORK' }],
        usedStale: false, usedFloor: false, generatedAt: 1,
      }),
    };
    const app = express();
    app.use('/api/live', liveRouter({ aggregator: stub, enabled: { twitch: true, kick: true, youtube: false, floor: false }, warn: () => {} }));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const json = await (await fetch(`http://127.0.0.1:${server.address().port}/api/live?limit=24`)).json();
      assert.deepEqual(Object.keys(json.sources), LIVE_SOURCES, 'wire keys stay twitch/kick/youtube/floor');
      assert.ok(!('curated' in json.sources), 'curated must NOT leak into the §3 sources object');
      assert.equal(json.count, 2);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ---- Gemini env groundwork -------------------------------------------------

describe('env.loadEnv — Gemini groundwork (Phase 2, config only)', () => {
  const BASE = { NODE_ENV: 'development', JWT_SECRET: 'dev-only-secret-change-me-dev-only-secret' };

  it('GEMINI_API_KEY absent → feature disabled, no crash, model default gemini-3.8-flash', () => {
    const env = loadEnv({ ...BASE });
    assert.equal(env.geminiEnabled, false);
    assert.equal(env.GEMINI_MODEL, 'gemini-3.8-flash');
    assert.ok(env.warnings.some((w) => /GEMINI_API_KEY missing/i.test(w)));
  });

  it('GEMINI_API_KEY present → enabled; a custom GEMINI_MODEL is honored', () => {
    const env = loadEnv({ ...BASE, GEMINI_API_KEY: 'secret-do-not-log', GEMINI_MODEL: 'gemini-next' });
    assert.equal(env.geminiEnabled, true);
    assert.equal(env.GEMINI_MODEL, 'gemini-next');
    assert.ok(!env.warnings.some((w) => /GEMINI_API_KEY missing/i.test(w)));
  });
});

// ---- throttle resilience (added by verifier, 2026-10-04) -------------------
// Observed in the field: a burst of simultaneous keyless RSS fetches draws
// transient fake-404s per IP. The client must (a) retry each feed once, and
// (b) cache a PARTIAL refresh only briefly so a blip at boot cannot lock the
// grid short-filled for the full 10-minute TTL. Complete refreshes keep it.

describe('curated client — throttle resilience (retry + partial-cache TTL)', () => {
  const okFeed = { 'UCnews1': makeRes(rss('v1', 'N1', 'n1')), 'UCsport2': makeRes(rss('v2', 'S2', 'n2')), 'UCmusic3': makeRes(rss('v3', 'M3', 'n3')) };

  it('recovers a feed from a transient 404 via the single retry', async () => {
    let attempts = 0;
    const flaky = (_url) => {
      attempts += 1;
      return attempts === 1 ? makeRes('nope', { status: 404 }) : makeRes(rss('v1', 'N1', 'n1'));
    };
    const { fn } = mockRss({ ...okFeed, UCnews1: flaky });
    const client = createCuratedClient({ channels: CHANNELS, fetchImpl: fn, retryDelayMs: 0, ...quiet });
    const items = await client.getChannels();
    assert.equal(items.length, 3, 'flaky feed recovered on retry');
    assert.equal(attempts, 2);
  });

  it('partial refresh is cached only partialTtlMs; complete refresh keeps ttlMs', async () => {
    let t = 1000;
    const clock = { now: () => t };
    // UCsport2 permanently down → every refresh is partial (2/3).
    const down = { ...okFeed };
    delete down.UCsport2; // unlisted → 404 in mockRss
    const { fn, calls } = mockRss(down);
    const client = createCuratedClient({
      channels: CHANNELS, fetchImpl: fn, retryDelayMs: 0,
      ttlMs: 600_000, partialTtlMs: 60_000, now: clock.now, ...quiet,
    });

    const first = await client.getChannels();
    assert.equal(first.length, 2);
    const callsAfterFirst = calls.length;

    // Within the SHORT partial window → served from cache, no new fetches.
    t += 30_000;
    await client.getChannels();
    assert.equal(calls.length, callsAfterFirst, 'partial cache hit inside partialTtlMs');

    // Past it → a refresh actually re-runs (does NOT wait 10 minutes).
    t += 31_000;
    const third = await client.getChannels();
    assert.ok(calls.length > callsAfterFirst, 'partial cache expired → refreshed');
    assert.equal(third.length, 2);

    // A COMPLETE refresh keeps the long TTL.
    const okAll = mockRss(okFeed);
    const client2 = createCuratedClient({
      channels: CHANNELS, fetchImpl: okAll.fn, retryDelayMs: 0,
      ttlMs: 600_000, partialTtlMs: 60_000, now: clock.now, ...quiet,
    });
    assert.equal((await client2.getChannels()).length, 3);
    const fullCalls = okAll.calls.length;
    t += 120_000; // > partialTtlMs, < ttlMs
    await client2.getChannels();
    assert.equal(okAll.calls.length, fullCalls, 'complete cache survives past partialTtlMs');
  });

  it('honors the concurrency cap (never more than N fetches in flight)', async () => {
    let active = 0;
    let peak = 0;
    const slowRss = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return makeRes(rss(`v${Math.random().toString(36).slice(2, 8)}`, 't', 'a'));
    };
    const many = Array.from({ length: 8 }, (_, i) => ({ channelId: `UCx${i}`, name: `C${i}`, category: 'News' }));
    const client = createCuratedClient({ channels: many, fetchImpl: slowRss, concurrency: 2, staggerMs: 0, retryDelayMs: 0, ...quiet });
    const items = await client.getChannels();
    assert.equal(items.length, 8);
    assert.ok(peak <= 2, `peak in-flight ${peak} must be ≤ 2`);
  });
});
