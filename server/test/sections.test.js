import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sectionsRouter, FALLBACK_QUERIES } from '../src/routes/sections.js';
import { makeLiveChannel } from '../src/aggregator/schema.js';

// ---------------------------------------------------------------------------
// s4 — GET /api/live/sections: Kick rows fill the four landing buckets; a
// bucket with ZERO Kick rows gets source-labelled YouTube live rows (the
// owner's empty-section fallback), and NOTHING fires on the happy path. The
// whole point is honest labeling + never fabricating + never 500ing.
// ---------------------------------------------------------------------------

const kickRow = (slug, bucket, extra = {}) =>
  makeLiveChannel({
    source: 'kick',
    nativeId: slug,
    title: `${slug} stream`,
    channelName: slug,
    channelSlug: slug,
    bucket,
    viewerCount: 100,
    watchUrl: `https://kick.com/${slug}`,
    language: 'en',
    ...extra,
  });

const ytRow = (vid, extra = {}) =>
  makeLiveChannel({
    source: 'youtube',
    nativeId: vid,
    title: `yt ${vid}`,
    channelName: `Channel ${vid}`,
    channelSlug: `UC${vid}`,
    viewerCount: 50,
    thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    watchUrl: `https://www.youtube.com/watch?v=${vid}`,
    ...extra,
  });

function aggStub(items, flags = {}) {
  return {
    getChannels: async () => ({
      items,
      sources: { kick: items.length },
      degraded: [],
      usedStale: flags.usedStale || false,
      usedFloor: flags.usedFloor || false,
      generatedAt: 1,
    }),
  };
}

function ytStub(map, opts = {}) {
  const calls = [];
  return {
    calls,
    searchLive: async (q, limit) => {
      calls.push(q);
      if (opts.throwOn && opts.throwOn.includes(q)) throw new Error('quota dead');
      return (map[q] || []).slice(0, limit);
    },
  };
}

async function start({ aggregator, youtube, warn = () => {} }) {
  const app = express();
  app.use('/api/live/sections', sectionsRouter({ aggregator, youtube, warn }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

describe('GET /api/live/sections — kick-first fill', () => {
  it('buckets Kick rows by `bucket` and NEVER calls YouTube when every section has rows', async () => {
    const yt = ytStub({});
    const s = await start({
      aggregator: aggStub([
        kickRow('s1', 'sports'),
        kickRow('n1', 'news'),
        kickRow('i1', 'irl'),
        kickRow('g1', 'games'),
      ]),
      youtube: yt,
    });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.deepEqual(Object.keys(json.items), ['sports', 'news', 'irl', 'games']);
      assert.equal(json.items.sports[0].source, 'kick');
      assert.equal(json.items.sports[0].fallback, undefined, 'kick rows carry no fallback flag');
      assert.equal(yt.calls.length, 0, 'happy path must not burn YouTube quota');
      assert.deepEqual(json.fallbackUsed, {}, 'no section reports fallback');
      assert.equal(json.servedFrom, 'live');
    } finally { await s.close(); }
  });

  it('drops provably non-English Kick rows (s3 rule) instead of counting them as fill', async () => {
    const yt = ytStub({ [FALLBACK_QUERIES.sports]: [ytRow('v1')] });
    const s = await start({
      aggregator: aggStub([kickRow('s1', 'sports', { language: 'pt' })]),
      youtube: yt,
    });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.equal(json.items.sports.length, 1);
      assert.equal(json.items.sports[0].source, 'youtube', 'non-English Kick row did not block the fallback');
      assert.equal(json.items.sports[0].sourceLabel, 'YouTube');
    } finally { await s.close(); }
  });

  it('ignores non-kick and out-of-section rows for the bucket fill', async () => {
    const s = await start({
      aggregator: aggStub([
        kickRow('s1', 'sports'),
        ytRow('v1'),
        kickRow('o1', 'other'),
      ]),
      youtube: ytStub({}),
    });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.equal(json.items.sports.length, 1);
      assert.equal(json.items.sports[0].id, 'kick:s1');
    } finally { await s.close(); }
  });
});

describe('GET /api/live/sections — s4 empty-section fallback', () => {
  it('fills ONLY the empty buckets with labelled YouTube rows and marks fallbackUsed', async () => {
    const yt = ytStub({
      [FALLBACK_QUERIES.news]: [ytRow('n1'), ytRow('n2')],
      [FALLBACK_QUERIES.irl]: [ytRow('i1')],
      [FALLBACK_QUERIES.games]: [ytRow('g1')],
    });
    const s = await start({ aggregator: aggStub([kickRow('s1', 'sports')]), youtube: yt });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.equal(json.items.sports[0].source, 'kick', 'the section WITH kick rows is untouched');
      assert.equal(yt.calls.length, 3, 'one search per EMPTY section only');
      assert.equal(json.items.news.length, 2);
      assert.equal(json.items.news[0].source, 'youtube');
      assert.equal(json.items.news[0].fallback, true);
      assert.equal(json.items.news[0].sourceLabel, 'YouTube');
      assert.deepEqual(json.fallbackUsed, { news: true, irl: true, games: true });
      assert.equal(json.servedFrom, 'live');
    } finally { await s.close(); }
  });

  it('caches per query: a second request within the TTL does not re-search', async () => {
    const yt = ytStub({ [FALLBACK_QUERIES.news]: [ytRow('n1')] });
    const s = await start({ aggregator: aggStub([kickRow('s1', 'sports')]), youtube: yt });
    try {
      await (await fetch(`${s.base}/api/live/sections`)).json();
      await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.equal(yt.calls.filter((q) => q === FALLBACK_QUERIES.news).length, 1, 'quota-bounded refresh');
    } finally { await s.close(); }
  });

  it('a failed fallback search degrades to an honest empty bucket, other sections still served', async () => {
    const warns = [];
    const yt = ytStub(
      { [FALLBACK_QUERIES.irl]: [ytRow('i1')] },
      { throwOn: [FALLBACK_QUERIES.news, FALLBACK_QUERIES.games, FALLBACK_QUERIES.sports] },
    );
    const s = await start({ aggregator: aggStub([]), youtube: yt, warn: (m) => warns.push(m) });
    try {
      const res = await fetch(`${s.base}/api/live/sections`);
      const json = await res.json();
      assert.equal(res.status, 200, 'never 500s');
      assert.deepEqual(json.items.sports, []);
      assert.equal(json.items.irl.length, 1);
      assert.equal(json.fallbackUsed.news, false);
      assert.ok(warns.some((w) => w.includes('news')), 'failure is warned, not hidden');
    } finally { await s.close(); }
  });

  it('stale or floor grids never fire fallback searches (emptiness is not proven)', async () => {
    const yt = ytStub({});
    const s = await start({ aggregator: aggStub([], { usedStale: true }), youtube: yt });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.equal(yt.calls.length, 0);
      assert.equal(json.servedFrom, 'stale');
      assert.deepEqual(json.items.news, []);
    } finally { await s.close(); }
  });

  it('no YouTube client wired at all → honest empty sections (kick-first survives)', async () => {
    const s = await start({
      aggregator: aggStub([kickRow('s1', 'sports')]),
      youtube: undefined,
    });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections`)).json();
      assert.equal(json.items.sports.length, 1);
      assert.deepEqual(json.items.news, []);
      assert.equal(json.fallbackUsed.news, undefined, 'no fallback reported');
    } finally { await s.close(); }
  });

  it('an aggregator crash serves an honest empty response, never a 500', async () => {
    const s = await start({
      aggregator: { getChannels: async () => { throw new Error('boom'); } },
      youtube: ytStub({}),
    });
    try {
      const res = await fetch(`${s.base}/api/live/sections`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.servedFrom, 'empty');
      assert.deepEqual(json.items.sports, []);
    } finally { await s.close(); }
  });

  it('clamps the per-section limit into [1..9] (default 6)', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => kickRow(`s${i}`, 'sports'));
    const s = await start({ aggregator: aggStub(rows), youtube: ytStub({}) });
    try {
      const json = await (await fetch(`${s.base}/api/live/sections?limit=9`)).json();
      assert.equal(json.items.sports.length, 9);
      const json2 = await (await fetch(`${s.base}/api/live/sections?limit=99`)).json();
      assert.equal(json2.items.sports.length, 9, 'clamped to the 3×3 expanded grid');
    } finally { await s.close(); }
  });
});
