import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFloorClient, normalizeFloorStream } from '../src/floor/client.js';

function makeRes(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, headers: { get: () => null } };
}

function mockRouter(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, headers: opts.headers || {} });
    for (const r of routes) {
      if (url.includes(r.match)) return typeof r.res === 'function' ? r.res(url, opts) : r.res;
    }
    throw new Error(`unmocked URL: ${url}`);
  };
  return { fn, calls };
}

const KEY = 'livepeer-key-do-not-log';

describe('floor client — guaranteed fallback (the never-empty rung)', () => {
  it('returns ONE configured channel with NO network when a fallback URL is set', () => {
    const { fn, calls } = mockRouter([]);
    const c = createFloorClient({
      fallback: { url: 'https://cdn/floor/index.m3u8', title: 'Always Live', channelName: 'LiveEdge Floor', category: '24/7' },
      fetchImpl: fn,
    });
    const [ch] = c.getGuaranteedChannel();
    assert.equal(ch.source, 'floor');
    assert.equal(ch.watchUrl, 'https://cdn/floor/index.m3u8');
    assert.equal(ch.title, 'Always Live');
    assert.equal(ch.isLive, true);
    assert.equal(calls.length, 0, 'guaranteed fallback must not touch the network');
  });

  it('returns [] when unconfigured (honest empty — never fabricates a stream)', () => {
    const c = createFloorClient({ fallback: { url: '' } });
    assert.deepEqual(c.getGuaranteedChannel(), []);
    assert.equal(c.hasGuaranteed(), false);
  });
});

describe('floor client — best-effort Livepeer discovery', () => {
  it('no API key → [] and no network (fallback still guarantees the grid)', async () => {
    const { fn, calls } = mockRouter([]);
    const c = createFloorClient({ apiKey: undefined, fallback: { url: 'https://cdn/floor/index.m3u8' }, fetchImpl: fn });
    assert.deepEqual(await c.getTopLiveChannels(), []);
    assert.equal(calls.length, 0);
  });

  it('with a key, lists live streams and builds an HLS playback URL', async () => {
    const { fn, calls } = mockRouter([
      {
        match: '/studio/streams',
        res: makeRes({ data: [{ id: 's1', name: 'Chill Cam', playbackId: 'PB1', ready: true }] }),
      },
    ]);
    const c = createFloorClient({ apiKey: KEY, hlsBase: 'https://stream.livepeer.com', fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1);
    assert.equal(list[0].source, 'floor');
    assert.equal(list[0].watchUrl, 'https://stream.livepeer.com/PB1/index.m3u8');
    assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
    assert.ok(calls[0].url.includes('status=live'));
  });

  it('discovery 5xx degrades to [] (never throws)', async () => {
    const warnings = [];
    const { fn } = mockRouter([{ match: '/studio/streams', res: makeRes({ error: 'x' }, { status: 500 }) }]);
    const c = createFloorClient({ apiKey: KEY, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    assert.ok(warnings.some((w) => /Floor getTopLiveChannels failed/i.test(w)));
  });
});

describe('normalizeFloorStream', () => {
  it('leaves watchUrl blank when no playbackId/base (no guessed host)', () => {
    const ch = normalizeFloorStream({ id: 'x', name: 'Y' }, { hlsBase: '' });
    assert.equal(ch.watchUrl, null);
  });
});
