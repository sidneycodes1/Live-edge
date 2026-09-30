import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { twitchRouter } from '../src/routes/twitch.js';
import { errorHandler } from '../src/middleware/error.js';
import { TwitchError } from '../src/twitch/errors.js';

// Standalone mount with a stub client — no DB, no network. Covers: renders from
// a fixture response, clamps limit, degrades to demo when disabled, and forwards
// errors to the shared error handler (never an uncaught 500 leak).
function fixture(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    userLogin: `chan${i}`,
    userName: `Chan${i}`,
    title: `Stream ${i}`,
    gameName: 'Just Chatting',
    viewerCount: 100 + i,
    startedAt: '2021-03-10T03:18:11Z',
    thumbnailUrl: `https://cdn/chan${i}-320x180.jpg`,
  }));
}

async function start(stub, enabled) {
  const app = express();
  app.use('/api/twitch', twitchRouter({ twitch: stub, enabled }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((r) => server.close(r)),
  };
}

describe('GET /api/twitch/live', () => {
  it('returns real items from the client when enabled', async () => {
    let seenLimit = null;
    const stub = { getTopLiveStreams: async (n) => { seenLimit = n; return fixture(3); } };
    const s = await start(stub, true);
    try {
      const res = await fetch(`${s.base}/api/twitch/live?limit=3`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(seenLimit, 3);
      assert.equal(json.enabled, true);
      assert.equal(json.source, 'twitch');
      assert.equal(json.items.length, 3);
      assert.equal(json.count, 3);
      assert.equal(json.items[0].userLogin, 'chan0');
    } finally { await s.close(); }
  });

  it('clamps limit to Helix max 100', async () => {
    let seenLimit = null;
    const stub = { getTopLiveStreams: async (n) => { seenLimit = n; return []; } };
    const s = await start(stub, true);
    try {
      await fetch(`${s.base}/api/twitch/live?limit=9999`);
      assert.equal(seenLimit, 100);
    } finally { await s.close(); }
  });

  it('degrades to demo mode (enabled=false, source=demo) when creds missing', async () => {
    const stub = { getTopLiveStreams: async () => [] };
    const s = await start(stub, false);
    try {
      const res = await fetch(`${s.base}/api/twitch/live`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.enabled, false);
      assert.equal(json.source, 'demo');
      assert.deepEqual(json.items, []);
    } finally { await s.close(); }
  });

  it('forwards a client error to the error handler (no crash, clean JSON error)', async () => {
    const stub = { getTopLiveStreams: async () => { throw new TwitchError('HELIX_ERROR', 'boom', { status: 503 }); } };
    const s = await start(stub, true);
    try {
      const res = await fetch(`${s.base}/api/twitch/live`);
      const json = await res.json();
      assert.equal(res.status, 503);
      assert.ok(json.error);
      assert.equal(json.error.code, 'HELIX_ERROR');
    } finally { await s.close(); }
  });
});
