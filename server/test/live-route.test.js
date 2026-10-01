import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { liveRouter } from '../src/routes/live.js';
import { errorHandler } from '../src/middleware/error.js';

async function start(stub, enabled) {
  const app = express();
  app.use('/api/live', liveRouter({ aggregator: stub, enabled }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

describe('GET /api/live', () => {
  it('returns merged items + per-source status', async () => {
    let seenLimit = null;
    const stub = {
      getChannels: async (n) => {
        seenLimit = n;
        return {
          items: [{ id: 'twitch:1', source: 'twitch', viewerCount: 9 }],
          sources: { twitch: 1, kick: 0 },
          degraded: [{ source: 'kick', reason: 'HTTP_ERROR' }],
          usedStale: false,
          usedFloor: false,
          generatedAt: 123,
        };
      },
    };
    const s = await start(stub, { twitch: true, kick: false, youtube: false, floor: false });
    try {
      const res = await fetch(`${s.base}/api/live?limit=8`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(seenLimit, 8);
      assert.equal(json.count, 1);
      assert.equal(json.items[0].source, 'twitch');
      assert.equal(json.enabled.twitch, true);
      assert.equal(json.enabled.kick, false);
      assert.deepEqual(json.degraded, [{ source: 'kick', reason: 'HTTP_ERROR' }]);
      assert.equal(json.empty, false);
    } finally { await s.close(); }
  });

  it('clamps limit into [1..100] and defaults to 24', async () => {
    const seen = [];
    const stub = { getChannels: async (n) => { seen.push(n); return { items: [], sources: {}, degraded: [] }; } };
    const s = await start(stub, {});
    try {
      await fetch(`${s.base}/api/live?limit=9999`);
      await fetch(`${s.base}/api/live?limit=0`);
      await fetch(`${s.base}/api/live`);
      assert.deepEqual(seen, [100, 1, 24]);
    } finally { await s.close(); }
  });

  it('flags an honest empty result (empty=true, degraded surfaced, still 200)', async () => {
    const stub = { getChannels: async () => ({ items: [], sources: {}, degraded: [{ source: 'kick', reason: 'TIMEOUT' }], usedStale: false, usedFloor: false, generatedAt: 1 }) };
    const s = await start(stub, {});
    try {
      const res = await fetch(`${s.base}/api/live`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.empty, true);
      assert.equal(json.count, 0);
      assert.deepEqual(json.degraded, [{ source: 'kick', reason: 'TIMEOUT' }]);
    } finally { await s.close(); }
  });

  it('surfaces the ladder flags (usedStale / usedFloor) to the client', async () => {
    const stub = { getChannels: async () => ({ items: [{ id: 'floor:x', source: 'floor' }], sources: {}, degraded: [], usedStale: false, usedFloor: true, generatedAt: 2 }) };
    const s = await start(stub, { floor: true });
    try {
      const json = await (await fetch(`${s.base}/api/live`)).json();
      assert.equal(json.usedFloor, true);
      assert.equal(json.usedStale, false);
      assert.equal(json.empty, false);
    } finally { await s.close(); }
  });

  it('forwards an aggregator crash to the error handler (no uncaught 500 leak)', async () => {
    const stub = { getChannels: async () => { throw new Error('internal'); } };
    const s = await start(stub, {});
    try {
      const res = await fetch(`${s.base}/api/live`);
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.ok(json.error);
    } finally { await s.close(); }
  });
});
