import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';
import { MAX_PINS } from '../src/routes/pins.js';

// ---------------------------------------------------------------------------
// Live pins: the user's "watching / playing with them" shelf. Contract locked
// here: auth-only, FIFO ordering, UPSERT on re-pin, the HARD cap of 4
// (re-pinning an existing stream never consumes a new slot), per-user
// isolation, and idempotent delete.
// ---------------------------------------------------------------------------

async function authedFetch() {
  const { fetchJson } = await makeApp();
  const W = genWallet();
  let r = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, r.json.message);
  r = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  const token = r.json.token;
  const auth = (path, opts = {}) =>
    fetchJson(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  return { auth, user: r.json.user };
}

const pin = (id, over = {}) => ({
  streamId: id,
  source: 'youtube',
  title: `Stream ${id}`,
  payload: { thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq.jpg`, watchUrl: `https://youtu.be/${id}` },
  ...over,
});

describe('pins API (auth, max 4, FIFO, upsert, isolation)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('requires auth on every verb', async () => {
    const { fetchJson } = await makeApp();
    const g = await fetchJson('/api/pins');
    assert.equal(g.res.status, 401);
    const p = await fetchJson('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:v1')) });
    assert.equal(p.res.status, 401);
    const d = await fetchJson('/api/pins/youtube%3Av1', { method: 'DELETE' });
    assert.equal(d.res.status, 401);
  });

  it('empty shelf → {items:[], count:0, max:4}', async () => {
    const { auth } = await authedFetch();
    const r = await auth('/api/pins');
    assert.equal(r.json.count, 0);
    assert.deepEqual(r.json.items, []);
    assert.equal(r.json.max, MAX_PINS);
    assert.equal(MAX_PINS, 4, 'the product cap is 4 — changing it must be a deliberate act');
  });

  it('pins keep FIFO order (first pin leads the shelf)', async () => {
    const { auth } = await authedFetch();
    await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:a')) });
    await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:b')) });
    const r = await auth('/api/pins');
    assert.deepEqual(r.json.items.map((i) => i.stream_id), ['youtube:a', 'youtube:b']);
  });

  it('re-pinning UPSERTs the snapshot and never takes a second slot', async () => {
    const { auth } = await authedFetch();
    await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:x', { title: 'old title' })) });
    const r = await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:x', { title: 'refreshed title' })) });
    assert.equal(r.res.status, 201);
    assert.equal(r.json.count, 1);
    assert.equal(r.json.items[0].title, 'refreshed title');
    assert.equal(r.json.items[0].payload.thumbnailUrl, 'https://i.ytimg.com/vi/youtube:x/hq.jpg');
  });

  it(`hard-caps at ${MAX_PINS}: 5th NEW pin → 409 PIN_LIMIT, but re-pins still work when full`, async () => {
    const { auth } = await authedFetch();
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const r = await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin(`youtube:${id}`)) });
      assert.equal(r.res.status, 201);
    }
    const over = await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:p5')) });
    assert.equal(over.res.status, 409);
    assert.equal(over.json.error.code, 'PIN_LIMIT');
    const again = await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:p2', { title: 'still updatable' })) });
    assert.equal(again.res.status, 201, 'updating an existing pin when full is allowed');
    assert.equal(again.json.count, 4);
  });

  it('delete removes the slot and is idempotent; unpin → pin frees room for a new one', async () => {
    const { auth } = await authedFetch();
    for (const id of ['f1', 'f2', 'f3', 'f4']) await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin(`youtube:${id}`)) });
    const del = await auth(`/api/pins/${encodeURIComponent('youtube:f2')}`, { method: 'DELETE' });
    assert.equal(del.res.status, 200);
    assert.deepEqual(del.json.items.map((i) => i.stream_id), ['youtube:f1', 'youtube:f3', 'youtube:f4']);
    const delAgain = await auth(`/api/pins/${encodeURIComponent('youtube:f2')}`, { method: 'DELETE' });
    assert.equal(delAgain.res.status, 200, 'deleting a non-pinned id is a no-op, not an error');
    const fifth = await auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:f5')) });
    assert.equal(fifth.res.status, 201, 'the freed slot is usable');
  });

  it('pins are per-user — user B never sees or shares user A shelf', async () => {
    const a = await authedFetch();
    const b = await authedFetch();
    await a.auth('/api/pins', { method: 'POST', body: JSON.stringify(pin('youtube:secret')) });
    const rb = await b.auth('/api/pins');
    assert.equal(rb.json.count, 0);
    const delB = await b.auth(`/api/pins/${encodeURIComponent('youtube:secret')}`, { method: 'DELETE' });
    const ra = await a.auth('/api/pins');
    assert.equal(ra.json.count, 1, "another user's DELETE must not touch my pin");
    assert.equal(delB.json.count, 0);
  });

  it('rejects malformed pin bodies (validation, not 500)', async () => {
    const { auth } = await authedFetch();
    const bad = await auth('/api/pins', { method: 'POST', body: JSON.stringify({ streamId: 'x' }) });
    assert.equal(bad.res.status, 400);
  });
});
