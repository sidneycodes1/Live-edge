import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFloorClient, normalizeFloorStream } from '../src/floor/client.js';

// -----------------------------------------------------------------------------
// Agent D (QA) contract tests for the Floor (Livepeer) client
// (docs/live-aggregation-spec.md §6 row "Floor / Livepeer — client DONE"; §1
// LiveChannel; §3 ladder terminal rung; §4 honesty). Injected fetchImpl; no
// real network; nothing existing weakened.
//
// Floor has TWO duties: (a) best-effort discovery via Livepeer Studio API and
// (b) a network-free guaranteed fallback that is the LADDER'S LAST RUNG. The
// fallback path is what makes the grid never blank when everything else fails
// AND no stale cache exists — so both sides are asserted here.
// -----------------------------------------------------------------------------

function makeRes(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    headers: { get: () => null },
  };
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

const KEY = 'livepeer-test-key-do-not-log';
const HLS = 'https://play.test.livepeer';

function discoveryFixture() {
  return {
    data: [
      {
        id: 'stream-a',
        name: 'Always-on floor channel',
        playbackId: 'pb-A',
        ready: true,
        viewer_count: 1234,
        createdAt: '2026-09-30T12:00:00Z',
        poster: 'https://cdn.test/pb-A.jpg',
      },
      { id: 'stream-b', name: 'Secondary', playbackId: 'pb-B', ready: true },
    ],
    total: 2,
  };
}

describe('normalizeFloorStream → LiveChannel (spec §1 + §4)', () => {
  it('maps every field and builds the HLS watch URL from playbackId + configured hlsBase', () => {
    const c = normalizeFloorStream(discoveryFixture().data[0], { hlsBase: HLS });
    assert.equal(c.id, 'floor:stream-a');
    assert.equal(c.source, 'floor');
    assert.equal(c.title, 'Always-on floor channel');
    assert.equal(c.channelName, 'Always-on floor channel');
    assert.equal(c.channelSlug, 'stream-a');
    assert.equal(c.category, '', 'floor has no source-native category; never invented');
    assert.equal(c.viewerCount, 1234);
    assert.equal(c.startedAt, '2026-09-30T12:00:00Z');
    assert.equal(c.thumbnailUrl, 'https://cdn.test/pb-A.jpg');
    assert.equal(c.isLive, true);
    assert.equal(c.isMature, false);
    assert.equal(c.watchUrl, `${HLS}/pb-A/index.m3u8`);
  });

  it('NO playbackId OR no hlsBase → watchUrl null, NEVER a guessed URL (§4: no fabricated image/URL)', () => {
    const noPlay = normalizeFloorStream({ id: 'x', name: 'x' }, { hlsBase: HLS });
    assert.equal(noPlay.watchUrl, null);
    const noBase = normalizeFloorStream({ id: 'y', playbackId: 'pb-Y' }, { hlsBase: '' });
    assert.equal(noBase.watchUrl, null, 'must not build a URL against a base that could 404');
  });

  it('hlsBase trailing slash is trimmed exactly once (single / before playbackId)', () => {
    const c = normalizeFloorStream({ id: 'z', playbackId: 'pb-Z' }, { hlsBase: `${HLS}///` });
    assert.equal(c.watchUrl, `${HLS}/pb-Z/index.m3u8`);
  });

  it('falls back to playbackId for id/slug when raw.id is missing', () => {
    const c = normalizeFloorStream({ playbackId: 'pb-only', name: 'n' }, { hlsBase: HLS });
    assert.equal(c.id, 'floor:pb-only');
    assert.equal(c.channelSlug, 'pb-only');
  });

  it('missing viewer count → 0, NOT fabricated (§4 honesty)', () => {
    const c = normalizeFloorStream({ id: 'x', name: 'x', ready: true }, { hlsBase: HLS });
    assert.equal(c.viewerCount, 0);
  });
});

describe('floor client — discovery (Livepeer Studio API, spec §6)', () => {
  it('missing API key → getTopLiveChannels returns [] and NEVER fires network', async () => {
    const { fn, calls } = mockRouter([]);
    const c = createFloorClient({ apiKey: undefined, fetchImpl: fn, warn: () => {} });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    assert.equal(calls.length, 0, 'no discovery creds means no discovery HTTP');
  });

  it('correct GET /studio/streams?status=live&limit=N with Bearer <apiKey>', async () => {
    const { fn, calls } = mockRouter([
      { match: 'api.livepeer.com/studio/streams', res: makeRes(discoveryFixture()) },
    ]);
    const c = createFloorClient({ apiKey: KEY, hlsBase: HLS, fetchImpl: fn });
    const list = await c.getTopLiveChannels(15);
    assert.equal(list.length, 2);
    assert.equal(calls[0].url, 'https://api.livepeer.com/studio/streams?status=live&limit=15');
    assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
    assert.equal(list[0].watchUrl, `${HLS}/pb-A/index.m3u8`);
  });

  it('upstream 5xx → [] (never throws) and API key is NOT echoed in the warning', async () => {
    const warnings = [];
    const { fn } = mockRouter([
      { match: 'api.livepeer.com/studio/streams', res: makeRes({ error: 'boom' }, { status: 500 }) },
    ]);
    const c = createFloorClient({ apiKey: KEY, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    for (const w of warnings) assert.ok(!w.includes(KEY), `warning must not leak API key: ${w}`);
  });

  it('stale cache preserved across a subsequent failure (spec §3 ladder fuel)', async () => {
    let t = 1000;
    let failMode = false;
    const { fn } = mockRouter([
      {
        match: 'api.livepeer.com/studio/streams',
        res: () => (failMode ? makeRes({ error: 'x' }, { status: 503 }) : makeRes(discoveryFixture())),
      },
    ]);
    const c = createFloorClient({
      apiKey: KEY, hlsBase: HLS, fetchImpl: fn, cacheTtlMs: 45000, now: () => t, warn: () => {},
    });
    assert.equal((await c.getTopLiveChannels(10)).length, 2);
    failMode = true;
    t += 46000;
    const after = await c.getTopLiveChannels(10);
    assert.equal(after.length, 2, 'failed refresh must serve stale, not []');
    assert.equal(after[0].id, 'floor:stream-a');
  });

  it('single-flight: concurrent getTopLiveChannels fires exactly one HTTP GET', async () => {
    const { fn, calls } = mockRouter([
      { match: 'api.livepeer.com/studio/streams', res: makeRes(discoveryFixture()) },
    ]);
    const c = createFloorClient({ apiKey: KEY, hlsBase: HLS, fetchImpl: fn });
    const [a, b, d] = await Promise.all([
      c.getTopLiveChannels(10), c.getTopLiveChannels(10), c.getTopLiveChannels(10),
    ]);
    assert.deepEqual(a, b);
    assert.deepEqual(b, d);
    assert.equal(calls.length, 1, 'inflight coalescing');
  });

  it('empty data → []', async () => {
    const { fn } = mockRouter([
      { match: 'api.livepeer.com/studio/streams', res: makeRes({ data: [] }) },
    ]);
    const c = createFloorClient({ apiKey: KEY, hlsBase: HLS, fetchImpl: fn });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
  });
});

describe('floor client — getGuaranteedChannel (the LADDER\'S TERMINAL RUNG, §3)', () => {
  it('configured fallback → exactly one LiveChannel, NO network, source "floor", viewerCount honestly 0', () => {
    const { fn, calls } = mockRouter([]);
    const c = createFloorClient({
      apiKey: undefined, // even with no discovery creds, the guaranteed rung must work
      fallback: {
        url: 'https://my.self-hosted/live.m3u8',
        title: 'LiveEdge Always-On',
        channelName: 'LiveEdge Floor',
        category: 'IRL',
        thumbnailUrl: '',
      },
      fetchImpl: fn,
      warn: () => {},
    });
    const list = c.getGuaranteedChannel();
    assert.equal(list.length, 1);
    assert.equal(calls.length, 0, 'guaranteed rung is network-FREE');
    const ch = list[0];
    assert.equal(ch.id, 'floor:floor-fallback');
    assert.equal(ch.source, 'floor');
    assert.equal(ch.title, 'LiveEdge Always-On');
    assert.equal(ch.channelName, 'LiveEdge Floor');
    assert.equal(ch.category, 'IRL', 'category is CONFIG-supplied, never invented');
    assert.equal(ch.viewerCount, 0, 'honest 0 (§4: no provider exposes this)');
    assert.equal(ch.isLive, true);
    assert.equal(ch.watchUrl, 'https://my.self-hosted/live.m3u8');
  });

  it('UNCONFIGURED fallback → [] — HONEST EMPTY, never fabricate a stream (§4)', () => {
    const c = createFloorClient({ fallback: { url: '' }, warn: () => {} });
    assert.deepEqual(c.getGuaranteedChannel(), [], 'no url means no guaranteed channel; the grid must show empty, not a fake');
  });

  it('hasGuaranteed / hasDiscoveryCreds reflect configuration independently', () => {
    const c1 = createFloorClient({ apiKey: KEY, fallback: { url: 'https://x/y' }, warn: () => {} });
    assert.equal(c1.hasDiscoveryCreds(), true);
    assert.equal(c1.hasGuaranteed(), true);
    const c2 = createFloorClient({ apiKey: undefined, fallback: { url: 'https://x/y' }, warn: () => {} });
    assert.equal(c2.hasDiscoveryCreds(), false, 'guaranteed rung works WITHOUT discovery creds');
    assert.equal(c2.hasGuaranteed(), true);
    const c3 = createFloorClient({ apiKey: KEY, fallback: { url: '' }, warn: () => {} });
    assert.equal(c3.hasDiscoveryCreds(), true);
    assert.equal(c3.hasGuaranteed(), false);
  });
});
