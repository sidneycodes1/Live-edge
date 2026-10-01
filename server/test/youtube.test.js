import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeClient, normalizeYouTubeChannel } from '../src/youtube/client.js';

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

const KEY = 'yt-api-key-do-not-log';

function searchResp() {
  return {
    items: [
      {
        id: { kind: 'youtube#video', videoId: 'VID1' },
        snippet: {
          title: 'Live: Football Watch Party',
          channelTitle: 'EdgeTV',
          channelId: 'UC123',
          liveBroadcastContent: 'live',
          publishedAt: '2026-01-31T22:00:00Z',
          thumbnails: { medium: { url: 'https://img/VID1.jpg' } },
        },
      },
      {
        id: { kind: 'youtube#video', videoId: 'UPCOMING' },
        snippet: { title: 'Scheduled', channelTitle: 'EdgeTV', channelId: 'UC123', liveBroadcastContent: 'upcoming' },
      },
    ],
  };
}

function videosResp() {
  return {
    items: [
      {
        id: 'VID1',
        snippet: { title: 'Live: Football Watch Party', channelTitle: 'EdgeTV', channelId: 'UC123', thumbnails: { medium: { url: 'https://img/VID1.jpg' } } },
        liveStreamingDetails: { concurrentViewers: '9001', actualStartTime: '2026-01-31T21:55:00Z' },
      },
    ],
  };
}

describe('normalizeYouTubeChannel → LiveChannel', () => {
  it('merges search + detail into a LiveChannel with real viewer count', () => {
    const ch = normalizeYouTubeChannel(searchResp().items[0], videosResp().items[0]);
    assert.equal(ch.source, 'youtube');
    assert.equal(ch.id, 'youtube:VID1');
    assert.equal(ch.channelName, 'EdgeTV');
    assert.equal(ch.viewerCount, 9001); // string concurrentViewers → int
    assert.equal(ch.category, ''); // only numeric categoryId in API → no invented label
    assert.equal(ch.thumbnailUrl, 'https://img/VID1.jpg');
    assert.equal(ch.watchUrl, 'https://www.youtube.com/watch?v=VID1');
  });
});

describe('youtube client — missing key (graceful, no throw, no network)', () => {
  it('returns [] and warns without touching the network', async () => {
    const warnings = [];
    const { fn, calls } = mockRouter([]);
    const c = createYouTubeClient({ apiKey: undefined, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(), []);
    assert.equal(calls.length, 0);
    assert.ok(warnings.some((w) => /no API key/i.test(w)));
  });
});

describe('youtube client — two-step search + enrich', () => {
  it('filters to live items and enriches viewers from the videos call', async () => {
    const { fn, calls } = mockRouter([
      { match: '/search', res: makeRes(searchResp()) },
      { match: '/videos', res: makeRes(videosResp()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1, 'upcoming item dropped');
    assert.equal(list[0].viewerCount, 9001);
    assert.ok(calls[0].url.includes('eventType=live'), 'search filtered to live broadcasts');
    assert.ok(calls[0].url.includes(`key=${KEY}`));
    assert.ok(calls[1].url.includes('id=VID1'), 'videos call requested the live id');
  });

  it('a failed videos enrichment still returns search-only channels (never drops)', async () => {
    const warnings = [];
    const { fn } = mockRouter([
      { match: '/search', res: makeRes(searchResp()) },
      { match: '/videos', res: makeRes({ error: 'x' }, { status: 500 }) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1);
    assert.equal(list[0].viewerCount, 0, 'no detail → 0 viewers, not dropped');
    assert.ok(warnings.some((w) => /enrichment failed/i.test(w)));
  });

  it('search 5xx degrades to [] (never throws) and serves stale cache', async () => {
    let fail = false;
    const { fn } = mockRouter([
      { match: '/search', res: () => (fail ? makeRes({ error: 'x' }, { status: 500 }) : makeRes(searchResp())) },
      { match: '/videos', res: makeRes(videosResp()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn, cacheTtlMs: 0, warn: () => {} });
    await c.getTopLiveChannels(10);
    fail = true;
    const stale = await c.getTopLiveChannels(10);
    assert.equal(stale.length, 1, 'stale served after failure');
  });

  it('single-flight: concurrent calls share one inflight list fetch', async () => {
    const { fn, calls } = mockRouter([
      { match: '/search', res: makeRes(searchResp()) },
      { match: '/videos', res: makeRes(videosResp()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn, cacheTtlMs: 0 });
    await Promise.all([c.getTopLiveChannels(10), c.getTopLiveChannels(10), c.getTopLiveChannels(10)]);
    assert.equal(calls.filter((x) => x.url.includes('/search')).length, 1);
  });
});
