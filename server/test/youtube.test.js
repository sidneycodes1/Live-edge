import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeClient, normalizeYouTubeChannel } from '../src/youtube/client.js';

// -----------------------------------------------------------------------------
// Agent D (QA) contract tests for the YouTube client (docs/live-aggregation-spec
// .md §6 row "YouTube — client DONE"; §1 LiveChannel; §4 honesty). Injected
// fetchImpl; no real network; no existing test weakened.
//
// YouTube's boundary is the two-step search→videos pipeline with best-effort
// enrichment, so the tests below specifically prove: (a) search filtering to
// genuinely-live items, (b) enrichment failure NEVER drops results we already
// have, (c) no invented category (spec: numeric categoryId only → ''), and
// (d) cache/stale/single-flight parity with the twitch/kick siblings.
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

const KEY = 'yt-test-api-key-do-not-log';

function searchFixture() {
  return {
    items: [
      {
        id: { videoId: 'vid-LIVE-1' },
        snippet: {
          title: 'Search title — Lofi live',
          channelId: 'chan-1',
          channelTitle: 'Lofi Girl',
          publishedAt: '2026-09-30T18:00:00Z',
          liveBroadcastContent: 'live',
          thumbnails: { default: { url: 'https://i.ytimg.com/vi/vid-LIVE-1/default.jpg' } },
        },
      },
      {
        id: { videoId: 'vid-UPCOMING' },
        snippet: {
          title: 'Scheduled',
          channelId: 'chan-2',
          channelTitle: 'Someone',
          publishedAt: '2026-10-01T18:00:00Z',
          liveBroadcastContent: 'upcoming',
        },
      },
      {
        id: { videoId: 'vid-COMPLETED' },
        snippet: {
          title: 'Ended',
          channelId: 'chan-3',
          channelTitle: 'Other',
          publishedAt: '2026-09-29T18:00:00Z',
          liveBroadcastContent: 'completed',
        },
      },
    ],
  };
}

function videosFixture() {
  return {
    items: [
      {
        id: 'vid-LIVE-1',
        snippet: {
          title: 'Detail title — lofi hip hop radio',
          channelId: 'chan-1',
          channelTitle: 'Lofi Girl',
          thumbnails: {
            default: { url: 'https://i.ytimg.com/vi/vid-LIVE-1/default.jpg' },
            high: { url: 'https://i.ytimg.com/vi/vid-LIVE-1/hq.jpg' },
            medium: { url: 'https://i.ytimg.com/vi/vid-LIVE-1/mq.jpg' },
          },
        },
        liveStreamingDetails: {
          concurrentViewers: '24187',
          actualStartTime: '2026-09-30T17:58:11Z',
        },
      },
    ],
  };
}

describe('normalizeYouTubeChannel → LiveChannel (spec §1 + §4)', () => {
  it('prefers detail fields; category is EMPTY (source only offers a numeric id → never invented)', () => {
    const c = normalizeYouTubeChannel(searchFixture().items[0], videosFixture().items[0]);
    assert.equal(c.id, 'youtube:vid-LIVE-1', 'id is source-namespaced');
    assert.equal(c.source, 'youtube');
    assert.equal(c.title, 'Detail title — lofi hip hop radio', 'detail title wins over search title');
    assert.equal(c.channelName, 'Lofi Girl');
    assert.equal(c.channelSlug, 'chan-1');
    assert.equal(c.category, '', 'spec §1 + §6: YouTube categoryId is numeric only; we NEVER invent a bucket');
    assert.equal(c.viewerCount, 24187, 'concurrentViewers (string in the API) coerced to int');
    assert.equal(c.startedAt, '2026-09-30T17:58:11Z', 'actualStartTime wins over search publishedAt');
    assert.equal(c.thumbnailUrl, 'https://i.ytimg.com/vi/vid-LIVE-1/mq.jpg', 'thumbnails picked medium > high > default');
    assert.equal(c.isLive, true);
    assert.equal(c.isMature, false, 'YouTube exposes no mature flag at this boundary; must not fabricate');
    assert.equal(c.watchUrl, 'https://www.youtube.com/watch?v=vid-LIVE-1');
    assert.equal(c.language, null);
  });

  it('missing detail (partial enrichment failure) still yields a usable channel with viewerCount 0 — never drops the row', () => {
    const c = normalizeYouTubeChannel(searchFixture().items[0], undefined);
    assert.equal(c.id, 'youtube:vid-LIVE-1');
    assert.equal(c.title, 'Search title — Lofi live', 'falls back to search title when detail is absent');
    assert.equal(c.viewerCount, 0, 'no detail → 0, NOT a fabricated number (§4 honesty)');
    assert.equal(c.startedAt, '2026-09-30T18:00:00Z', 'falls back to search publishedAt');
  });

  it('empty videoId → id is "youtube:" + watchUrl null; LiveChannel shape fully defined', () => {
    const c = normalizeYouTubeChannel({ id: {}, snippet: { title: 'x' } }, undefined);
    assert.equal(c.watchUrl, null, 'no videoId → never build a broken watch URL');
    for (const k of ['id', 'source', 'title', 'channelName', 'channelSlug', 'category', 'viewerCount', 'startedAt', 'thumbnailUrl', 'isLive', 'isMature', 'watchUrl', 'language']) {
      assert.ok(k in c, `field ${k} must be present`);
    }
  });
});

describe('youtube client — missing credentials (spec §6: never throws, no network)', () => {
  it('getTopLiveChannels returns [] and warns, ZERO fetch calls', async () => {
    const warnings = [];
    const { fn, calls } = mockRouter([]);
    const c = createYouTubeClient({ apiKey: undefined, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    assert.equal(calls.length, 0);
    assert.ok(warnings.some((w) => /no API key/i.test(w)));
  });

  it('hasCreds() reflects key presence', () => {
    const { fn } = mockRouter([]);
    assert.equal(createYouTubeClient({ apiKey: '', fetchImpl: fn }).hasCreds(), false);
    assert.equal(createYouTubeClient({ apiKey: KEY, fetchImpl: fn }).hasCreds(), true);
  });
});

describe('youtube client — search step (eventType=live filter is not optional)', () => {
  it('calls /search with part/type/eventType/maxResults/q/key documented params', async () => {
    const { fn, calls } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(searchFixture()) },
      { match: '/youtube/v3/videos', res: makeRes(videosFixture()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, query: 'football', fetchImpl: fn });
    await c.getTopLiveChannels(15);
    const searchUrl = calls[0].url;
    assert.ok(searchUrl.startsWith('https://www.googleapis.com/youtube/v3/search?'), searchUrl);
    const u = new URL(searchUrl);
    assert.equal(u.searchParams.get('part'), 'snippet');
    assert.equal(u.searchParams.get('type'), 'video');
    assert.equal(u.searchParams.get('eventType'), 'live');
    assert.equal(u.searchParams.get('maxResults'), '15');
    assert.equal(u.searchParams.get('q'), 'football');
    assert.equal(u.searchParams.get('key'), KEY);
  });

  it('drops non-live items (upcoming/completed) BEFORE the videos call', async () => {
    const { fn, calls } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(searchFixture()) },
      { match: '/youtube/v3/videos', res: makeRes(videosFixture()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1, 'only the single liveBroadcastContent==="live" row survives');
    assert.equal(list[0].id, 'youtube:vid-LIVE-1');
    const videosUrl = calls[1].url;
    assert.ok(videosUrl.includes('id=vid-LIVE-1'), `videos call must request only the live id, got ${videosUrl}`);
    assert.ok(!videosUrl.includes('vid-UPCOMING'), 'upcoming must not be requested');
    assert.ok(!videosUrl.includes('vid-COMPLETED'), 'completed must not be requested');
  });

  it('no live rows → [] AND does not fire a pointless /videos call', async () => {
    const { fn, calls } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes({ items: [] }) },
      { match: '/youtube/v3/videos', res: makeRes(videosFixture()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    assert.equal(calls.length, 1, 'short-circuit after empty search');
  });

  it('search 5xx → [] (never throws); the API key is not echoed in the warning', async () => {
    const warnings = [];
    const { fn } = mockRouter([{ match: '/youtube/v3/search', res: makeRes({ error: 'boom' }, { status: 503 }) }]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    for (const w of warnings) assert.ok(!w.includes(KEY), `warning must not leak API key: ${w}`);
  });
});

describe('youtube client — videos enrichment is best-effort, never a hard dependency', () => {
  it('videos 5xx STILL yields the row (search-only mapping with viewerCount 0 — honest, not fabricated)', async () => {
    const warnings = [];
    const { fn } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(searchFixture()) },
      { match: '/youtube/v3/videos', res: makeRes({ error: 'boom' }, { status: 500 }) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn, warn: (m) => warnings.push(m) });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1, 'enrichment failure must NOT drop the row');
    assert.equal(list[0].id, 'youtube:vid-LIVE-1');
    assert.equal(list[0].viewerCount, 0, 'viewer count honest (0) when detail is unavailable');
    assert.ok(warnings.some((w) => /videos enrichment failed/i.test(w)));
  });
});

describe('youtube client — ended-stream prune (a game that is OVER must leave the live grid)', () => {
  it('drops a live-indexed video whose detail carries actualEndTime (proven over)', async () => {
    const search = searchFixture();
    search.items.unshift({
      id: { videoId: 'vid-ENDED-2' },
      snippet: {
        title: 'Match central — search index still says live',
        channelId: 'chan-9',
        channelTitle: 'Sports TV',
        publishedAt: '2026-10-04T10:00:00Z',
        liveBroadcastContent: 'live',
        thumbnails: { medium: { url: 'https://i.ytimg.com/vi/vid-ENDED-2/mq.jpg' } },
      },
    });
    const videos = videosFixture();
    videos.items.push({
      id: 'vid-ENDED-2',
      snippet: { title: 'Match central — FINAL', channelId: 'chan-9', channelTitle: 'Sports TV', thumbnails: {} },
      liveStreamingDetails: { actualStartTime: '2026-10-04T10:00:00Z', actualEndTime: '2026-10-04T12:30:00Z' },
    });
    const { fn } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(search) },
      { match: '/youtube/v3/videos', res: makeRes(videos) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.deepEqual(list.map((x) => x.id), ['youtube:vid-LIVE-1'], 'only the broadcast still provably live survives');
  });

  it('enrichment failure keeps the row — we only remove what we can PROVE ended (§4 honesty)', async () => {
    // Same search, but the videos detail omits vid-LIVE-1 entirely: no evidence
    // of an end → the item stays (the 5xx test above proves the thrown path).
    const { fn } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(searchFixture()) },
      { match: '/youtube/v3/videos', res: makeRes({ items: [] }) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.deepEqual(list.map((x) => x.id), ['youtube:vid-LIVE-1'], 'unprovable end → never guessed');
  });
});

describe('youtube client — cache, stale, single-flight (ladder fuel semantics)', () => {
  it('caches within TTL — a single search+videos pipeline call', async () => {
    let t = 1000;
    const { fn, calls } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(searchFixture()) },
      { match: '/youtube/v3/videos', res: makeRes(videosFixture()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn, cacheTtlMs: 45000, now: () => t });
    await c.getTopLiveChannels(10);
    await c.getTopLiveChannels(10);
    const searches = calls.filter((x) => x.url.includes('/youtube/v3/search')).length;
    assert.equal(searches, 1, 'within TTL → one pipeline call');
    t += 46000;
    await c.getTopLiveChannels(10);
    assert.equal(calls.filter((x) => x.url.includes('/youtube/v3/search')).length, 2, 'past TTL refetches');
  });

  it('stale cache preserved on a subsequent failure (spec §3 ladder)', async () => {
    let t = 1000;
    let failMode = false;
    const { fn } = mockRouter([
      {
        match: '/youtube/v3/search',
        res: () => (failMode ? makeRes({ error: 'x' }, { status: 500 }) : makeRes(searchFixture())),
      },
      { match: '/youtube/v3/videos', res: makeRes(videosFixture()) },
    ]);
    const c = createYouTubeClient({
      apiKey: KEY, fetchImpl: fn, cacheTtlMs: 45000, now: () => t, warn: () => {},
    });
    const first = await c.getTopLiveChannels(10);
    assert.equal(first.length, 1);
    failMode = true;
    t += 46000;
    const second = await c.getTopLiveChannels(10);
    assert.equal(second.length, 1, 'failed refresh serves stale cache');
    assert.equal(second[0].id, 'youtube:vid-LIVE-1');
  });

  it('single-flight: concurrent getTopLiveChannels fires exactly ONE search call', async () => {
    const { fn, calls } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(searchFixture()) },
      { match: '/youtube/v3/videos', res: makeRes(videosFixture()) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    const [a, b, d] = await Promise.all([
      c.getTopLiveChannels(10), c.getTopLiveChannels(10), c.getTopLiveChannels(10),
    ]);
    assert.deepEqual(a, b);
    assert.deepEqual(b, d);
    assert.equal(calls.filter((x) => x.url.includes('/youtube/v3/search')).length, 1);
  });

  it('limit is clamped to [1..50] per YouTube maxResults contract', async () => {
    const { fn, calls } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes({ items: [] }) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, fetchImpl: fn });
    await c.getTopLiveChannels(9999);
    assert.ok(new URL(calls[0].url).searchParams.get('maxResults') === '50', calls[0].url);
  });
});

// --- Phase 3 (Tier-B): multi-query fan-out -----------------------------------

function searchWith(videoId, title, channelTitle) {
  return {
    items: [
      {
        id: { videoId },
        snippet: {
          title,
          channelId: `chan-${videoId}`,
          channelTitle,
          publishedAt: '2026-10-04T10:00:00Z',
          liveBroadcastContent: 'live',
          thumbnails: { medium: { url: `https://i.ytimg.com/vi/${videoId}/mq.jpg` } },
        },
      },
    ],
  };
}

describe('youtube client — Tier-B multi-query (queries replaces query)', () => {
  it('merges results from EVERY query, and tags operator categories', async () => {
    const { fn, calls } = mockRouter([
      { match: 'q=football%20live', res: makeRes(searchWith('vid-fb', 'Match live', 'Kickoff TV')) },
      { match: 'q=cricket%20live', res: makeRes(searchWith('vid-ck', 'Innings live', 'Cricket 24')) },
      { match: '/youtube/v3/videos', res: makeRes({ items: [] }) },
    ]);
    const c = createYouTubeClient({
      apiKey: KEY,
      query: 'ignored-when-queries-set',
      queries: [{ q: 'football live', category: 'Football' }, { q: 'cricket live', category: 'Cricket' }],
      fetchImpl: fn,
    });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((x) => x.id), ['youtube:vid-fb', 'youtube:vid-ck']);
    assert.equal(list[0].category, 'Football', 'operator query label fills the empty category');
    assert.equal(list[1].category, 'Cricket');
    const searchUrls = calls.filter((x) => x.url.includes('/youtube/v3/search')).map((x) => x.url);
    assert.equal(searchUrls.length, 2, 'one search per query (concurrent, quota counted per call)');
    for (const u of searchUrls) assert.equal(new URL(u).searchParams.get('maxResults'), '5', 'fair-share: limit 10 split across 2 queries');
    assert.ok(!searchUrls[0].includes('ignored-when-queries-set'));
  });

  it('dedupes a video returned by two different queries', async () => {
    const same = searchWith('vid-x', 'Dual-posted stream', 'Both TV');
    const { fn } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes(same) },
      { match: '/youtube/v3/videos', res: makeRes({ items: [] }) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, queries: ['a live', 'b live'], fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1);
  });

  it('a failing query NEVER sinks the others (partial results win)', async () => {
    const { fn } = mockRouter([
      { match: 'q=bad%20live', res: makeRes({ error: { message: 'boom' } }, { status: 500 }) },
      { match: 'q=good%20live', res: makeRes(searchWith('vid-ok', 'Good live', 'OK TV')) },
      { match: '/youtube/v3/videos', res: makeRes({ items: [] }) },
    ]);
    const c = createYouTubeClient({ apiKey: KEY, queries: ['bad live', 'good live'], fetchImpl: fn });
    const list = await c.getTopLiveChannels(10);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'youtube:vid-ok');
  });

  it('ALL queries failing → boundary still never throws (stale/empty contract)', async () => {
    const { fn } = mockRouter([
      { match: '/youtube/v3/search', res: makeRes({ error: { message: 'quota' } }, { status: 429 }) },
    ]);
    const warnings = [];
    const c = createYouTubeClient({ apiKey: KEY, queries: ['a live', 'b live'], fetchImpl: fn, warn: (m) => warnings.push(m) });
    assert.deepEqual(await c.getTopLiveChannels(10), []);
    assert.ok(warnings.some((w) => /quota|429|failed/i.test(w)));
  });
});
