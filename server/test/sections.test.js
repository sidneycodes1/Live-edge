import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sectionsRouter } from '../src/routes/sections.js';
import { makeLiveChannel } from '../src/aggregator/schema.js';

// ---------------------------------------------------------------------------
// GET /api/live/sections (Oct 2026): KICK PRIMARY, YOUTUBE BACKUP — AUTOMATICALLY.
// Kick fills each bucket; English-first ordering means a non-English Kick row is
// KEPT in its own section, never dropped to YouTube. A bucket with ZERO Kick rows
// fills ONLY from real rows — merged YouTube/floor provider rows, then the quota-
// free curated 24/7 channels. There is NO generic youtube.searchLive filler, and a
// section that stays empty is left empty (the UI hides it). A genuinely-live
// football broadcast is popped to the top of Sports. Never fabricates; never 500s.
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
    thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hq.jpg`,
    watchUrl: `https://www.youtube.com/watch?v=${vid}`,
    ...extra,
  });

function aggStub(items, flags = {}) {
  return {
    getChannels: async () => ({
      items,
      sources: { kick: items.length },
      degraded: [],
      usedStale: Boolean(flags.usedStale),
      usedFloor: Boolean(flags.usedFloor),
      generatedAt: 1,
    }),
  };
}

// A curated 24/7 channel as the curated CLIENT emits it (a raw shape, NOT a
// makeLiveChannel), so the test proves sections fills isLive/watchUrl via labelReal.
const curatedRow = (id, category, over = {}) => ({
  id: `yt-${id}`,
  source: 'curated-youtube',
  category,
  title: `curated ${id}`,
  channelName: `Channel ${id}`,
  owner: `Channel ${id}`,
  videoUrl: `https://www.youtube.com/watch?v=${id}`,
  liveEmbedUrl: `https://www.youtube.com/embed/live_stream?channel=UC${id}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq.jpg`,
  status: 'live-24-7',
  ...over,
});

function curatedStub(rows) {
  return { getChannels: async () => rows };
}

async function start({ aggregator, curated, warn = () => {} }) {
  const app = express();
  app.use('/api/live/sections', sectionsRouter({ aggregator, curated, warn }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const get = async (s, path = '') => (await fetch(`${s.base}/api/live/sections${path}`)).json();

describe('GET /api/live/sections — kick-first fill', () => {
  it('buckets Kick rows by `bucket` and reports no fallback', async () => {
    const s = await start({
      aggregator: aggStub([
        kickRow('s1', 'sports'),
        kickRow('n1', 'news'),
        kickRow('i1', 'irl'),
        kickRow('g1', 'games'),
      ]),
    });
    try {
      const json = await get(s);
      assert.deepEqual(Object.keys(json.items), ['sports', 'news', 'irl', 'games']);
      assert.equal(json.items.sports[0].source, 'kick');
      assert.equal(json.items.sports[0].fallback, undefined, 'kick rows carry no fallback flag');
      assert.deepEqual(json.fallbackUsed, {}, 'no section reports fallback');
      assert.equal(json.servedFrom, 'live');
    } finally { await s.close(); }
  });

  it('KEEPS a non-English Kick row in its own bucket (Kick primary — no YouTube hand-off)', async () => {
    const s = await start({ aggregator: aggStub([kickRow('s1', 'sports', { language: 'pt' })]) });
    try {
      const json = await get(s);
      assert.equal(json.items.sports.length, 1);
      assert.equal(json.items.sports[0].source, 'kick', 'a non-English Kick row is NOT dropped to YouTube');
    } finally { await s.close(); }
  });

  it('ignores out-of-section rows for the bucket fill', async () => {
    const s = await start({
      aggregator: aggStub([kickRow('s1', 'sports'), ytRow('v1'), kickRow('o1', 'other')]),
    });
    try {
      const json = await get(s);
      assert.equal(json.items.sports.length, 1);
      assert.equal(json.items.sports[0].id, 'kick:s1');
    } finally { await s.close(); }
  });
});

describe('GET /api/live/sections — YouTube backup rungs (no search filler)', () => {
  it('fills an empty section from a merged YouTube provider row routed by category', async () => {
    const s = await start({
      aggregator: aggStub([kickRow('s1', 'sports'), ytRow('v1', { category: 'News' })]),
    });
    try {
      const json = await get(s);
      assert.equal(json.items.sports[0].source, 'kick', 'kick-first still holds where Kick has rows');
      assert.equal(json.items.news.length, 1, 'the merged YouTube News row filled the empty News bucket');
      assert.equal(json.items.news[0].source, 'youtube');
      assert.equal(json.items.news[0].fallback, true);
      assert.equal(json.items.news[0].sourceLabel, 'YouTube');
      assert.equal(json.fallbackUsed.news, true);
    } finally { await s.close(); }
  });

  it('rescues a section from the quota-free curated 24/7 channels', async () => {
    const s = await start({
      aggregator: aggStub([kickRow('s1', 'sports')]),
      curated: curatedStub([curatedRow('n1', 'News'), curatedRow('n2', 'News')]),
    });
    try {
      const json = await get(s);
      assert.equal(json.items.news.length, 2, 'curated 24/7 channels filled News');
      assert.equal(json.items.news[0].source, 'curated-youtube');
      assert.equal(json.items.news[0].isLive, true, 'sections fills isLive for curated rows');
      assert.ok(json.items.news[0].watchUrl, 'sections fills watchUrl from the curated videoUrl');
      assert.equal(json.items.news[0].sourceLabel, 'YouTube');
    } finally { await s.close(); }
  });

  it('a section empty after Kick + YouTube + curated stays HONESTLY empty (no filler, no 500)', async () => {
    const s = await start({ aggregator: aggStub([]), curated: curatedStub([]) });
    try {
      const res = await fetch(`${s.base}/api/live/sections`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(json.items.sports, []);
      assert.equal(json.fallbackUsed.sports, undefined, 'an unfilled section reports no fallback');
      assert.equal(json.servedFrom, 'empty');
    } finally { await s.close(); }
  });

  it('never lets a non-Kick row override a section that has Kick rows (kick-first)', async () => {
    const s = await start({
      aggregator: aggStub([kickRow('n1', 'news'), ytRow('v1', { category: 'News' })]),
      curated: curatedStub([curatedRow('c1', 'News')]),
    });
    try {
      const json = await get(s);
      assert.equal(json.items.news.length, 1);
      assert.equal(json.items.news[0].source, 'kick', 'a Kick row wins over YouTube AND curated');
      assert.equal(json.items.news[0].fallback, undefined);
    } finally { await s.close(); }
  });
});

describe('GET /api/live/sections — P3 live football pops to the top of Sports', () => {
  it('re-orders the sports bucket so a genuinely-live football row leads, tagged + flagged', async () => {
    const s = await start({
      aggregator: aggStub([
        kickRow('gym', 'sports', { category: 'Fitness' }),
        kickRow('match', 'sports', { category: 'Soccer', title: 'Arsenal vs Chelsea live' }),
      ]),
    });
    try {
      const json = await get(s);
      assert.equal(json.items.sports[0].id, 'kick:match', 'the football row is popped to the top');
      assert.equal(json.items.sports[0].pinnedFootball, true);
      assert.equal(json.footballLive, true);
    } finally { await s.close(); }
  });

  it('footballLive is false and order is unchanged when no row is football', async () => {
    const s = await start({
      aggregator: aggStub([kickRow('ufc', 'sports', { category: 'UFC' }), kickRow('box', 'sports', { category: 'Boxing' })]),
    });
    try {
      const json = await get(s);
      assert.equal(json.footballLive, false);
      assert.equal(json.items.sports[0].id, 'kick:ufc', 'order preserved (stable) when nothing matches');
      assert.ok(!json.items.sports.some((r) => r.pinnedFootball));
    } finally { await s.close(); }
  });
});

describe('GET /api/live/sections — robustness + clamps', () => {
  it('an aggregator crash serves an honest empty response, never a 500', async () => {
    const s = await start({ aggregator: { getChannels: async () => { throw new Error('boom'); } } });
    try {
      const res = await fetch(`${s.base}/api/live/sections`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.servedFrom, 'empty');
      assert.deepEqual(json.items.sports, []);
    } finally { await s.close(); }
  });

  it('a stale grid is labelled honestly (servedFrom stale), sections left empty', async () => {
    const s = await start({ aggregator: aggStub([], { usedStale: true }) });
    try {
      const json = await get(s);
      assert.equal(json.servedFrom, 'stale');
      assert.deepEqual(json.items.news, []);
    } finally { await s.close(); }
  });

  it('clamps the per-section limit into [1..9] (default 6)', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => kickRow(`s${i}`, 'sports'));
    const s = await start({ aggregator: aggStub(rows) });
    try {
      const json = await get(s, '?limit=9');
      assert.equal(json.items.sports.length, 9);
      const json2 = await get(s, '?limit=99');
      assert.equal(json2.items.sports.length, 9, 'clamped to the 3×3 expanded grid');
    } finally { await s.close(); }
  });
});
