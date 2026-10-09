import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { liveRouter } from '../src/routes/live.js';

// ---------------------------------------------------------------------------
// Agent B: GET /api/live must (1) pass `bucket` through on Kick rows and
// (2) NOT surface YouTube curated rows on the default landing path (Kick-first
// product decision, BUILD_CONTRACT sec 0.4 / sec 5). No fabrication, no reorder.
// ---------------------------------------------------------------------------
async function start(stub, enabled = { kick: true }) {
  const app = express();
  app.use('/api/live', liveRouter({ aggregator: stub, enabled }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('GET /api/live - bucket passthrough + curated excluded from landing', () => {
  it('passes bucket through on Kick items and keeps source-native category', async () => {
    const stub = {
      getChannels: async () => ({
        items: [
          { id: 'kick:1', source: 'kick', channelSlug: 's1', category: 'VALORANT', bucket: 'games', viewerCount: 100 },
          { id: 'kick:2', source: 'kick', channelSlug: 's2', category: 'Just Chatting', bucket: 'irl', viewerCount: 50 },
        ],
        sources: { kick: 2 }, degraded: [], usedStale: false, usedFloor: false, generatedAt: 1,
      }),
    };
    const s = await start(stub);
    try {
      const json = await (await fetch(`${s.base}/api/live`)).json();
      assert.equal(json.items.length, 2);
      assert.deepEqual(json.items.map((i) => i.bucket), ['games', 'irl'], 'bucket survives the route mapping');
      assert.equal(json.items[0].category, 'VALORANT', 'category unchanged');
    } finally { await s.close(); }
  });

  it('drops YouTube curated rows from the default landing path', async () => {
    const stub = {
      getChannels: async () => ({
        items: [
          { id: 'kick:1', source: 'kick', channelSlug: 's1', bucket: 'games', viewerCount: 100 },
          { id: 'yt-abc', source: 'curated-youtube', channelName: 'Lofi', viewerCount: 0 },
        ],
        sources: { kick: 1, curated: 1 }, degraded: [], usedStale: false, usedFloor: false, generatedAt: 1,
      }),
    };
    const s = await start(stub);
    try {
      const json = await (await fetch(`${s.base}/api/live`)).json();
      assert.equal(json.count, 1);
      assert.equal(json.items.some((i) => i.source === 'curated-youtube'), false, 'curated must not be a landing source');
      assert.equal(json.items[0].source, 'kick');
      assert.ok('bucket' in json.items[0], 'kick row still carries bucket');
    } finally { await s.close(); }
  });

  it('does not fabricate when curated was the only row (honest empty)', async () => {
    const stub = {
      getChannels: async () => ({
        items: [{ id: 'yt-abc', source: 'curated-youtube', channelName: 'Lofi', viewerCount: 0 }],
        sources: { kick: 0, curated: 1 }, degraded: [], usedStale: false, usedFloor: false, generatedAt: 1,
      }),
    };
    const s = await start(stub);
    try {
      const json = await (await fetch(`${s.base}/api/live`)).json();
      assert.equal(json.count, 0, 'curated-only grid degrades to honest empty rather than surfacing curated');
      assert.equal(json.servedFrom, 'empty');
    } finally { await s.close(); }
  });

  it('leaves real YouTube provider rows intact (only curated is dropped)', async () => {
    const stub = {
      getChannels: async () => ({
        items: [
          { id: 'kick:1', source: 'kick', bucket: 'irl', viewerCount: 90 },
          { id: 'youtube:v1', source: 'youtube', bucket: 'other', viewerCount: 80 },
        ],
        sources: { kick: 1, youtube: 1 }, degraded: [], usedStale: false, usedFloor: false, generatedAt: 1,
      }),
    };
    const s = await start(stub, { kick: true, youtube: true });
    try {
      const json = await (await fetch(`${s.base}/api/live`)).json();
      assert.equal(json.items.length, 2, 'a real youtube provider row is NOT curated and stays');
      assert.equal(json.items[1].source, 'youtube');
      assert.equal(json.items[0].id, 'kick:1', 'kick-first ordering preserved');
    } finally { await s.close(); }
  });
});