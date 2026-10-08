import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveAggregator } from '../src/aggregator/index.js';
import { makeLiveChannel } from '../src/aggregator/schema.js';

// -----------------------------------------------------------------------------
// Agent D (QA) tests for the never-empty LADDER (docs/live-aggregation-spec.md
// §3). Proves: merge order + dedupe + sort, per-source `sources` counts,
// `degraded` reporting, and the acceptance criterion "grid is non-empty when
// 2 of 3 sources fail". Providers here are STUBS with the exact method names
// the aggregator actually calls (getTopLiveChannels / getGuaranteedChannel)
// so we test the ladder contract, not provider internals. No source change;
// nothing existing weakened.
//
// Twitch was retired (Oct 2026): Kick is the primary real-stream source and,
// like YouTube/Floor, returns normalized LiveChannel[] directly — so every
// provider stub here feeds LiveChannel rows and no shape mapping is needed.
// -----------------------------------------------------------------------------

const ch = (source, id, viewerCount, extra = {}) =>
  makeLiveChannel({ source, nativeId: id, viewerCount, title: `${source}-${id}`, ...extra });

function stubChannels(source, list) {
  return { getTopLiveChannels: async () => list.map((x) => x) };
}
function throwing(label) {
  // Every remaining provider uses getTopLiveChannels per spec §3, so one
  // generic throwing stub covers all of them.
  return { getTopLiveChannels: async () => { throw new Error(`${label} blew up`); } };
}

// Baseline no-op floor so ladder tests can opt-in/out of the guaranteed rung.
// Tests that need the guaranteed rung define a floor stub inline with the
// specific getGuaranteedChannel() payload they assert on, so nothing here is
// reused across scenarios that would hide a change in expectations.
const floorOff = { getGuaranteedChannel: () => [] };

// Silence warn output from the aggregator (it warns on every degraded source).
const quiet = { warn: () => {} };

describe('aggregator merge (spec §3 algorithm: ladder order, dedupe by id, sort by viewers)', () => {
  it('kick empty (ok) + youtube/floor THROW → ladder runs, no stale, no guaranteed → HONEST empty + 2 degraded reported', async () => {
    const agg = createLiveAggregator({
      kick: stubChannels('kick', []),
      youtube: throwing('youtube'),
      floor: throwing('floor'),
      enabled: { kick: true, youtube: true, floor: true },
      ...quiet,
    });
    // Kick returned [] (empty but NOT failed); youtube/floor threw.
    // Since merged length === 0 the ladder must fire (stale → floor → empty),
    // and with no stale cache and floor failing, this degrades to honest empty.
    const r = await agg.getChannels(24);
    assert.deepEqual(r.items, [], 'with all sources empty/failed AND no stale AND no floor → honest empty');
    assert.equal(r.usedStale, false);
    assert.equal(r.usedFloor, false);
    assert.equal(r.degraded.length, 2, 'youtube, floor reported degraded');
    assert.deepEqual(
      r.degraded.map((d) => d.source).sort(),
      ['floor', 'youtube'],
    );
  });

  it('2 of 3 sources FAIL but 1 returns data → grid is NON-EMPTY (never-empty promise)', async () => {
    const survivor = [ch('kick', 'kb-1', 999), ch('kick', 'kb-2', 500)];
    const agg = createLiveAggregator({
      kick: stubChannels('kick', survivor),
      youtube: throwing('youtube'),
      floor: throwing('floor'),
      enabled: { kick: true, youtube: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.ok(r.items.length >= 1, 'grid MUST be non-empty when ≥1 source returned data');
    assert.equal(r.items.length, 2);
    assert.equal(r.usedStale, false);
    assert.equal(r.usedFloor, false);
    // Degraded reports the 2 failures without blanking the grid.
    assert.deepEqual(r.degraded.map((d) => d.source).sort(), ['floor', 'youtube']);
    // Sources count reflects what actually merged.
    assert.equal(r.sources.kick, 2);
    assert.equal(r.sources.youtube, 0);
  });

  it('sorts by viewerCount desc and dedupes by namespaced id across sources', async () => {
    const agg = createLiveAggregator({
      kick: stubChannels('kick', [ch('kick', 'same', 1000), ch('kick', 'kb', 5000), ch('kick', 'kb', 5000 /* dup */)]),
      youtube: stubChannels('youtube', [ch('youtube', 'same', 9999)]), // same nativeId, different source namespace
      floor: stubChannels('floor', [ch('floor', 'fl', 100)]),
      enabled: { kick: true, youtube: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    // 'kick:same' and 'youtube:same' are DIFFERENT ids after namespacing,
    // so both survive. kick:kb is only counted once.
    const ids = r.items.map((i) => i.id);
    assert.ok(ids.includes('kick:same'));
    assert.ok(ids.includes('youtube:same'));
    assert.equal(ids.filter((i) => i === 'kick:kb').length, 1, 'exact duplicate id must be deduped');
    // viewerCount descending
    const viewers = r.items.map((i) => i.viewerCount);
    assert.deepEqual(viewers, [...viewers].sort((a, b) => b - a));
  });

  it('limit is applied AFTER dedupe + sort, so a full grid is truncated cleanly', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ch('kick', `k-${i}`, 1000 - i));
    const agg = createLiveAggregator({
      kick: stubChannels('kick', many),
      youtube: stubChannels('youtube', []),
      floor: floorOff,
      enabled: { kick: true, youtube: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(5);
    assert.equal(r.items.length, 5);
    // Top-5 by viewers (kick 1000, 999, 998, 997, 996)
    assert.deepEqual(r.items.map((i) => i.viewerCount), [1000, 999, 998, 997, 996]);
  });
});

describe('enabled gating + per-source limits (spec §3 composition contract)', () => {
  it('disabled providers are NEVER called (network-free off-switch)', async () => {
    let kickCalls = 0;
    let youtubeCalls = 0;
    const agg = createLiveAggregator({
      kick: { getTopLiveChannels: async () => { kickCalls += 1; return []; } },
      youtube: { getTopLiveChannels: async () => { youtubeCalls += 1; return []; } },
      enabled: { kick: true, youtube: false },
      ...quiet,
    });
    await agg.getChannels(24);
    assert.equal(kickCalls, 1);
    assert.equal(youtubeCalls, 0, 'youtube disabled must not be invoked');
  });

  it('per-source `limits` override the top-level limit', async () => {
    const seen = {};
    const stub = (name) => ({ getTopLiveChannels: async (l) => { seen[name] = l; return []; } });
    const agg = createLiveAggregator({
      kick: stub('kick'),
      youtube: stub('youtube'),
      enabled: { kick: true, youtube: true },
      limits: { kick: 5, youtube: 50 },
      ...quiet,
    });
    await agg.getChannels(24);
    assert.equal(seen.kick, 5);
    assert.equal(seen.youtube, 50);
  });
});

describe('never-empty LADDER rungs (spec §3 algorithm steps 3a/3b/3c)', () => {
  it('after a fresh success, a subsequent total failure serves the STALE cache (usedStale=true)', async () => {
    let fail = false;
    const kick = {
      getTopLiveChannels: async () => {
        if (fail) throw new Error('boom');
        return [ch('kick', 'a', 1000)];
      },
    };
    const agg = createLiveAggregator({ kick, enabled: { kick: true }, floor: floorOff, ...quiet });
    const r1 = await agg.getChannels(24);
    assert.equal(r1.usedStale, false);
    assert.equal(r1.items.length, 1);
    fail = true;
    const r2 = await agg.getChannels(24);
    assert.equal(r2.usedStale, true, 'ladder must serve stale when merge is empty');
    assert.equal(r2.items.length, 1);
    assert.equal(r2.items[0].id, 'kick:a');
  });

  it('no stale cache + floor configured → serve guaranteed floor (usedFloor=true, ZERO network)', async () => {
    const agg = createLiveAggregator({
      kick: stubChannels('kick', []),
      floor: { getTopLiveChannels: async () => [], getGuaranteedChannel: () => [ch('floor', 'guar', 0, { watchUrl: 'https://f/x.m3u8', title: 'Always-on', channelSlug: 'guar' })] },
      enabled: { kick: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(r.usedFloor, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].id, 'floor:guar');
  });

  it('no stale cache + floor UNCONFIGURED → HONEST EMPTY [] (spec §4: never fabricate a stream)', async () => {
    const agg = createLiveAggregator({
      kick: stubChannels('kick', []),
      floor: floorOff, // getGuaranteedChannel returns []
      enabled: { kick: true, floor: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.deepEqual(r.items, [], 'honest empty is a first-class spec outcome, not a bug');
    assert.equal(r.usedStale, false);
    assert.equal(r.usedFloor, false);
  });
});

describe('providerRunner integration inside the ladder (spec §5 "no single provider can 500 the grid")', () => {
  it('a THROWING provider degrades to count 0 + reason; sibling providers still merge', async () => {
    const agg = createLiveAggregator({
      kick: throwing('kick'),
      youtube: stubChannels('youtube', [ch('youtube', 'ok', 500)]),
      enabled: { kick: true, youtube: true },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(r.items.length, 1, 'grid still non-empty from youtube');
    const degradedKick = r.degraded.find((d) => d.source === 'kick');
    assert.ok(degradedKick, 'kick reported degraded');
    // Aggregator catches the raw Error and its reason becomes a generic ERROR or the code field.
    assert.ok(typeof degradedKick.reason === 'string' && degradedKick.reason.length > 0);
  });

  it('all providers with a CIRCUIT_OPEN reason surface that code per-source (spec §5 code taxonomy)', async () => {
    // Trip the kick breaker by giving a client that throws ProviderError CIRCUIT_OPEN directly.
    const err = new Error('x');
    err.code = 'CIRCUIT_OPEN';
    const agg = createLiveAggregator({
      kick: { getTopLiveChannels: async () => { throw err; } },
      enabled: { kick: true },
      resilience: { retries: 0 },
      ...quiet,
    });
    const r = await agg.getChannels(24);
    assert.equal(r.degraded[0].source, 'kick');
    assert.equal(r.degraded[0].reason, 'CIRCUIT_OPEN');
  });
});

describe('AggResult shape (spec §3: the internal return contract)', () => {
  it('exposes { items, sources, degraded, usedStale, usedFloor, generatedAt }', async () => {
    const agg = createLiveAggregator({
      kick: stubChannels('kick', [ch('kick', '1', 100)]),
      enabled: { kick: true },
      now: () => 1234567890,
      ...quiet,
    });
    const r = await agg.getChannels(24);
    for (const k of ['items', 'sources', 'degraded', 'usedStale', 'usedFloor', 'generatedAt']) {
      assert.ok(k in r, `AggResult must expose "${k}"`);
    }
    assert.equal(r.generatedAt, 1234567890, 'injected clock honored so the route can compute freshness');
    assert.equal(typeof r.sources, 'object');
    assert.equal(Array.isArray(r.degraded), true);
  });
});
