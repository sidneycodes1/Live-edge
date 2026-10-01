import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { liveRouter } from '../src/routes/live.js';
import { errorHandler } from '../src/middleware/error.js';

async function start(stub, enabled, warn = () => {}) {
  const app = express();
  app.use('/api/live', liveRouter({ aggregator: stub, enabled, warn }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

// §3 wire shape: { items, count, servedFrom, generatedAt:<ISO>, sources:{ name:{
// enabled, ok, count, degraded, reason? } } }.
describe('GET /api/live — §3 mapping', () => {
  it('maps AggResult to the §3 shape: items, count, servedFrom=live, ISO generatedAt, per-source view', async () => {
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
    const s = await start(stub, { twitch: true, kick: true, youtube: false, floor: false });
    try {
      const res = await fetch(`${s.base}/api/live?limit=8`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(seenLimit, 8);
      assert.equal(json.count, 1);
      assert.equal(json.items[0].source, 'twitch');
      assert.equal(json.servedFrom, 'live');
      // ISO string round-trips to the aggregator's numeric epoch (123ms).
      assert.equal(new Date(json.generatedAt).getTime(), 123);
      // All four source keys always present, ladder order.
      assert.deepEqual(Object.keys(json.sources), ['twitch', 'kick', 'youtube', 'floor']);
      assert.deepEqual(json.sources.twitch, { enabled: true, ok: true, count: 1, degraded: false });
      // kick was tried but degraded → ok=false, reason carries the ProviderError.code.
      assert.deepEqual(json.sources.kick, { enabled: true, ok: false, count: 0, degraded: true, reason: 'HTTP_ERROR' });
      // youtube disabled → not ok, not degraded (never tried).
      assert.deepEqual(json.sources.youtube, { enabled: false, ok: false, count: 0, degraded: false });
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

  it('reports servedFrom=empty for an honest empty grid (still 200, degraded surfaced)', async () => {
    const stub = { getChannels: async () => ({ items: [], sources: {}, degraded: [{ source: 'kick', reason: 'TIMEOUT' }], usedStale: false, usedFloor: false, generatedAt: 1 }) };
    const s = await start(stub, { kick: true });
    try {
      const res = await fetch(`${s.base}/api/live`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.servedFrom, 'empty');
      assert.equal(json.count, 0);
      assert.deepEqual(json.items, []);
      assert.deepEqual(json.sources.kick, { enabled: true, ok: false, count: 0, degraded: true, reason: 'TIMEOUT' });
    } finally { await s.close(); }
  });

  it('maps usedStale→servedFrom=stale and usedFloor→servedFrom=floor', async () => {
    const stale = { getChannels: async () => ({ items: [{ id: 'twitch:1', source: 'twitch' }], sources: {}, degraded: [], usedStale: true, usedFloor: false, generatedAt: 1 }) };
    const ss = await start(stale, { twitch: true });
    try {
      const json = await (await fetch(`${ss.base}/api/live`)).json();
      assert.equal(json.servedFrom, 'stale');
    } finally { await ss.close(); }

    const floor = { getChannels: async () => ({ items: [{ id: 'floor:x', source: 'floor' }], sources: {}, degraded: [], usedStale: false, usedFloor: true, generatedAt: 2 }) };
    const fs = await start(floor, { floor: true });
    try {
      const json = await (await fetch(`${fs.base}/api/live`)).json();
      assert.equal(json.servedFrom, 'floor');
    } finally { await fs.close(); }
  });

  it('NEVER 500s: an unexpected aggregator crash degrades to an honest-empty §3 response', async () => {
    const warns = [];
    const stub = { getChannels: async () => { throw new Error('internal'); } };
    const s = await start(stub, { twitch: true }, (m) => warns.push(m));
    try {
      const res = await fetch(`${s.base}/api/live`);
      assert.equal(res.status, 200, 'live must never surface a 500 (§3)');
      const json = await res.json();
      assert.equal(json.servedFrom, 'empty');
      assert.equal(json.count, 0);
      assert.deepEqual(json.items, []);
      // The enabled source is honestly reported degraded rather than silently empty.
      assert.equal(json.sources.twitch.degraded, true);
      assert.equal(json.sources.twitch.reason, 'INTERNAL');
      assert.ok(warns.some((w) => /aggregator threw/i.test(w)), 'crash is logged, not swallowed');
    } finally { await s.close(); }
  });
});
