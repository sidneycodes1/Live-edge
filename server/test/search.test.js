import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { searchRouter } from '../src/routes/search.js';

// ---------------------------------------------------------------------------
// /api/search (Phase 2 depth pass, Oct 2026): Kick exact channel-slug
// resolution (BUILD_CONTRACT sec 5) + the FULL Kick page (100) as tier 1 + the
// YouTube search fallback (tier 3, only on zero hits). Fake clients are injected
// so every path is exercised hermetically (no network). Rules proven here: a
// LIVE slug resolves to a hit even when it is absent from every list; a
// non-live/unknown slug is NEVER a hit; a creator missing from the rotating
// grid is found via the deep Kick page; YouTube is consulted ONLY on a miss
// and never fabricated into a hit.
// ---------------------------------------------------------------------------
async function start({ kick, youtube, items = [] }) {
  const aggregator = {
    getChannels: async () => ({ items }),
  };
  const app = express();
  app.use('/api/search', searchRouter({ aggregator, kick, youtube }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('GET /api/search - Kick exact channel-slug resolution', () => {
  it('returns a live Kick channel for an exact slug even when it is NOT in the browse list', async () => {
    const kick = {
      getChannelBySlug: async (slug) => ({
        slug, isLive: true, displayName: 'Amouranth', broadcasterUserId: 'bu-9',
        category: 'Just Chatting', title: 'hanging out', viewerCount: 4200,
        startedAt: '2026-10-08T00:00:00Z', language: 'en',
      }),
    };
    const s = await start({ kick, items: [] });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=amouranth`)).json();
      assert.equal(json.items.length, 1);
      const it = json.items[0];
      assert.equal(it.source, 'kick');
      assert.equal(it.channelSlug, 'amouranth');
      assert.equal(it.isLive, true);
      assert.equal(it.bucket, 'irl', 'the slug hit carries a derived bucket');
      assert.equal(it.category, 'Just Chatting', 'category stays source-native');
      assert.equal(it.thumbnailUrl, '', 'no fabricated thumbnail');
    } finally { await s.close(); }
  });

  it('does NOT return a non-live slug (never fabricate a live channel)', async () => {
    const kick = { getChannelBySlug: async (slug) => ({ slug, isLive: false, displayName: 'Sleepy', category: 'Just Chatting' }) };
    const s = await start({ kick, items: [] });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=sleepy`)).json();
      assert.deepEqual(json.items, []);
    } finally { await s.close(); }
  });

  it('unknown slug (getChannelBySlug -> null) is not a hit', async () => {
    const kick = { getChannelBySlug: async () => null };
    const s = await start({ kick, items: [] });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=nosuchchannel`)).json();
      assert.deepEqual(json.items, []);
    } finally { await s.close(); }
  });

  it('keeps the existing contains-filter over the Kick browse list', async () => {
    const kick = { getChannelBySlug: async () => null };
    const items = [
      { id: 'kick:a', source: 'kick', channelSlug: 'alice', channelName: 'alice', title: 'alice live', category: 'Gaming', bucket: 'games' },
      { id: 'kick:b', source: 'kick', channelSlug: 'bob', channelName: 'bob', title: 'other', category: 'Sports', bucket: 'sports' },
    ];
    const s = await start({ kick, items });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=alice`)).json();
      assert.equal(json.items.length, 1);
      assert.equal(json.items[0].channelSlug, 'alice');
    } finally { await s.close(); }
  });

  it('dedupes when the live slug is ALSO in the browse list', async () => {
    const kick = { getChannelBySlug: async (slug) => ({ slug, isLive: true, displayName: 'Alice', broadcasterUserId: 'a', category: 'Gaming' }) };
    const items = [{ id: 'kick:a', source: 'kick', channelSlug: 'alice', channelName: 'alice', category: 'Gaming', bucket: 'games' }];
    const s = await start({ kick, items });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=alice`)).json();
      assert.equal(json.items.filter((i) => i.channelSlug === 'alice').length, 1, 'the exact hit must not duplicate a browse row');
    } finally { await s.close(); }
  });

  it('skips the slug lookup for multi-word queries (not a single slug)', async () => {
    let called = false;
    const kick = { getChannelBySlug: async () => { called = true; return null; } };
    const s = await start({ kick, items: [] });
    try {
      await fetch(`${s.base}/api/search?q=league+finals`);
      assert.equal(called, false, 'a phrase must not trigger the exact-slug API');
    } finally { await s.close(); }
  });

  it('is honest when no kick client is wired (contains-filter only, no crash)', async () => {
    const s = await start({ kick: undefined, items: [] });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=xqc`)).json();
      assert.deepEqual(json.items, []);
    } finally { await s.close(); }
  });

  it('finds a creator that is NOT in the rotating grid via the full Kick page (100)', async () => {
    const deepRow = {
      id: 'kick:deep-77', source: 'kick', channelSlug: 'smallstream', channelName: 'smallstream',
      title: 'chill evening', category: 'IRL', bucket: 'irl', viewerCount: 55, isLive: true,
    };
    const kick = {
      getChannelBySlug: async () => null,
      getTopLiveChannels: async (limit) => { assert.equal(limit, 100, 'search asks Kick for the FULL page'); return [deepRow]; },
    };
    // The aggregator grid deliberately does NOT contain the row (rotation miss).
    const s = await start({ kick, items: [{ id: 'kick:other', source: 'kick', channelSlug: 'other', title: 'elsewhere' }] });
    try {
      const json = await (await fetch(`${s.base}/api/search?q=smallstream`)).json();
      assert.equal(json.items.length, 1);
      assert.equal(json.items[0].id, 'kick:deep-77');
    } finally { await s.close(); }
  });

  it('falls back to YouTube search ONLY when Kick tiers produced zero hits', async () => {
    let ytCalls = 0;
    const youtube = {
      searchLive: async (q) => {
        ytCalls += 1;
        assert.equal(q, 'lofi radio');
        return [{ id: 'youtube:vid1', source: 'youtube', title: 'lofi radio 24/7', channelName: 'Chill', isLive: true }];
      },
    };
    const kick = { getChannelBySlug: async () => null, getTopLiveChannels: async () => [] };
    const s = await start({ kick, youtube, items: [] });
    try {
      const miss = await (await fetch(`${s.base}/api/search?q=lofi+radio`)).json();
      assert.equal(ytCalls, 1, 'zero real hits must trigger the YouTube fallback');
      assert.equal(miss.items.length, 1);
      assert.equal(miss.items[0].source, 'youtube', 'fallback rows stay honestly source-labelled');
      // Happy path: a Kick hit means YouTube is NEVER called.
      const kick2 = { getChannelBySlug: async () => null, getTopLiveChannels: async () => [{ id: 'kick:a', source: 'kick', channelName: 'lofi radio guy', title: 't', isLive: true }] };
      const s2 = await start({ kick: kick2, youtube, items: [] });
      try {
        const hit = await (await fetch(`${s2.base}/api/search?q=lofi+radio`)).json();
        assert.equal(hit.items.length, 1);
        assert.equal(hit.items[0].source, 'kick');
        assert.equal(ytCalls, 1, 'a Kick hit must not spend YouTube quota');
      } finally { await s2.close(); }
    } finally { await s.close(); }
  });

  it('YouTube fallback failure degrades to an honest empty (never 500s, never fabricates)', async () => {
    const youtube = { searchLive: async () => { throw new Error('quota blown'); } };
    const kick = { getChannelBySlug: async () => null, getTopLiveChannels: async () => [] };
    const s = await start({ kick, youtube, items: [] });
    try {
      const res = await fetch(`${s.base}/api/search?q=anything`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.deepEqual(json.items, []);
    } finally { await s.close(); }
  });
});