import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveAggregator, twitchToLiveChannel } from '../src/aggregator/index.js';
import { makeLiveChannel } from '../src/aggregator/schema.js';

const NO_WARN = () => {};
const allOn = { twitch: true, kick: true, youtube: true, floor: true };

function twStream(id, viewers, login) {
  return { id, userLogin: login, userName: login, title: `T${id}`, gameName: 'GTA', viewerCount: viewers, startedAt: null, thumbnailUrl: '', isMature: false, language: 'en' };
}
function chan(source, id, viewers) {
  return makeLiveChannel({ source, nativeId: id, viewerCount: viewers, title: `${source}-${id}` });
}

// Build mutable stubs so a single test can flip a provider from "data" to "empty".
function makeStubs(initial = {}) {
  const state = { twitch: [twStream('t1', 100, 'afro')], kick: [chan('kick', 'k1', 200)], youtube: [], floor: [], ...initial };
  return {
    state,
    twitch: { getTopLiveStreams: async () => state.twitch },
    kick: { getTopLiveChannels: async () => state.kick },
    youtube: { getTopLiveChannels: async () => state.youtube },
    floor: {
      getTopLiveChannels: async () => state.floor,
      getGuaranteedChannel: () => (state.floorFallback ? [chan('floor', 'fallback', 0)] : []),
    },
  };
}

describe('twitchToLiveChannel', () => {
  it('maps the shipped twitch shape into the unified LiveChannel', () => {
    const ch = twitchToLiveChannel(twStream('t1', 100, 'afro'));
    assert.equal(ch.source, 'twitch');
    assert.equal(ch.id, 'twitch:t1');
    assert.equal(ch.category, 'GTA');
    assert.equal(ch.watchUrl, 'https://twitch.tv/afro');
  });
});

describe('aggregator — merge', () => {
  it('merges all enabled sources, dedupes, and sorts by viewers desc', async () => {
    const s = makeStubs({ youtube: [chan('youtube', 'y1', 500)], floor: [chan('floor', 'f1', 50)] });
    const agg = createLiveAggregator({ ...s, enabled: allOn, warn: NO_WARN });
    const { items, sources } = await agg.getChannels(10);
    assert.deepEqual(items.map((i) => i.source), ['youtube', 'kick', 'twitch', 'floor']); // 500,200,100,50
    assert.deepEqual(sources, { twitch: 1, kick: 1, youtube: 1, floor: 1 });
    assert.equal(items[0].viewerCount, 500);
  });

  it('honors the limit cap', async () => {
    const s = makeStubs({ kick: [chan('kick', 'a', 5), chan('kick', 'b', 4), chan('kick', 'c', 3)] });
    const agg = createLiveAggregator({ ...s, enabled: allOn, warn: NO_WARN });
    const { items } = await agg.getChannels(2);
    assert.equal(items.length, 2);
  });

  it('a throwing provider is isolated (degraded) but the others still merge', async () => {
    const s = makeStubs();
    s.kick = { getTopLiveChannels: async () => { throw new Error('boom'); } };
    const agg = createLiveAggregator({ twitch: s.twitch, kick: s.kick, youtube: s.youtube, floor: s.floor, enabled: allOn, warn: NO_WARN });
    const { items, sources, degraded } = await agg.getChannels(10);
    assert.equal(sources.kick, 0);
    assert.ok(degraded.some((d) => d.source === 'kick'));
    assert.ok(items.some((i) => i.source === 'twitch'), 'healthy sources survive');
  });

  it('a disabled provider is never called', async () => {
    let kickCalled = false;
    const agg = createLiveAggregator({
      twitch: { getTopLiveStreams: async () => [twStream('t1', 1, 'a')] },
      kick: { getTopLiveChannels: async () => { kickCalled = true; return []; } },
      youtube: { getTopLiveChannels: async () => [] },
      floor: { getTopLiveChannels: async () => [], getGuaranteedChannel: () => [] },
      enabled: { twitch: true, kick: false, youtube: true, floor: true },
      warn: NO_WARN,
    });
    const { sources } = await agg.getChannels(10);
    assert.equal(kickCalled, false);
    assert.equal(sources.kick, undefined, 'kick absent from sources when disabled');
  });
});

describe('aggregator — never-empty ladder', () => {
  it('merge empty + no stale → serves the config floor fallback (usedFloor)', async () => {
    const s = makeStubs({ twitch: [], kick: [], youtube: [], floor: [], floorFallback: true });
    const agg = createLiveAggregator({ ...s, enabled: allOn, warn: NO_WARN });
    const { items, usedStale, usedFloor } = await agg.getChannels(10);
    assert.equal(usedFloor, true);
    assert.equal(usedStale, false);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'floor');
  });

  it('merge empty + we had good data before → serves last-good stale cache (usedStale)', async () => {
    const s = makeStubs();
    const agg = createLiveAggregator({ ...s, enabled: allOn, warn: NO_WARN });
    const first = await agg.getChannels(10); // populates staleCache
    assert.equal(first.items.length, 2);
    // now everything goes dark (no floor fallback configured)
    s.state.twitch = [];
    s.state.kick = [];
    s.state.youtube = [];
    s.state.floor = [];
    const second = await agg.getChannels(10);
    assert.equal(second.usedStale, true);
    assert.equal(second.usedFloor, false);
    assert.ok(second.items.length > 0, 'stale cache keeps the grid non-empty');
  });

  it('nothing at all (empty sources, no stale, no floor) → honest empty, never throws', async () => {
    const s = makeStubs({ twitch: [], kick: [], youtube: [], floor: [], floorFallback: false });
    const agg = createLiveAggregator({ ...s, enabled: allOn, warn: NO_WARN });
    const { items, usedStale, usedFloor } = await agg.getChannels(10);
    assert.deepEqual(items, []);
    assert.equal(usedStale, false);
    assert.equal(usedFloor, false);
  });

  it('the ladder prefers stale over the floor fallback when both are available', async () => {
    const s = makeStubs({ floorFallback: true });
    const agg = createLiveAggregator({ ...s, enabled: allOn, warn: NO_WARN });
    await agg.getChannels(10); // seed stale with real twitch+kick
    s.state.twitch = [];
    s.state.kick = [];
    s.state.youtube = [];
    s.state.floor = [];
    const second = await agg.getChannels(10);
    assert.equal(second.usedStale, true, 'stale rung comes before the config floor');
    assert.equal(second.usedFloor, false);
  });
});
