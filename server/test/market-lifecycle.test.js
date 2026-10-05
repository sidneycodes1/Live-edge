import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb, acceptTerms } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  const terms = await acceptTerms(fetchJson, v.json.token);
  if (terms.res.status !== 200) throw new Error('acceptTerms fixture failed: ' + JSON.stringify(terms.json));
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function createRoom(fetchJson, U, title = 'Lifecycle Room') {
  const r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title }), headers: { Authorization: `Bearer ${U.token}` } });
  return r.json.id;
}

async function createMarket(fetchJson, U, roomId, question, endInMinutes = 10) {
  let r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule for tests', sourcesOfTruth: ['https://x'], endInMinutes }), headers: { Authorization: `Bearer ${U.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${U.token}` } });
  const sigM = signObj(U.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sigM }), headers: { Authorization: `Bearer ${U.token}` } });
  return r.json; // market row
}

async function buy(fetchJson, U, marketId, side, amount) {
  const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
  if (qq.res.status !== 200) return qq;
  const oid = qq.json.orderId;
  const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
  const s = signObj(U.kp, b.json.signPayload);
  return fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: s }), headers: { Authorization: `Bearer ${U.token}` } });
}

describe('market lifecycle (B3)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('a fresh 10-minute market is open immediately, accepts a quote and a trade', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const UA = await auth(fetchJson, A);
    const roomId = await createRoom(fetchJson, UA);
    const m = await createMarket(fetchJson, UA, roomId, 'Will the run finish under 30 minutes?', 10);

    assert.equal(m.status, 'open', 'newly created market must be open');
    assert.ok(new Date(m.end_time).getTime() > Date.now(), 'end_time must be in the future');

    const mget = await fetchJson(`/api/markets/${m.id}`);
    assert.equal(mget.json.status, 'open', 'still open after a read that runs the auto-close sweep');

    const q = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId: m.id, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UA.token}` } });
    assert.equal(q.res.status, 200, 'quote must succeed on a fresh market');

    const t = await buy(fetchJson, UA, m.id, 'yes', 5);
    assert.equal(t.res.status, 200, 'trade must succeed on a fresh market');
    assert.equal(t.json.trade.side, 'yes');
  });

  it('a market is only closed after its end_time has passed (auto-close sweep)', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const UA = await auth(fetchJson, A);
    const roomId = await createRoom(fetchJson, UA);
    const open = await createMarket(fetchJson, UA, roomId, 'Open market question ok?', 10);

    // Directly insert an already-expired market to simulate a market past its end.
    const expiredId = randomUUID();
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, start_time, end_time, resolution_time, yes_price, no_price, status)
       values($1,$2,$3,'sim',$4,'rule','{https://x}','gaming',$5,$5,$5,0.5,0.5,'open')`,
      [expiredId, roomId, UA.id, 'Expired market question here?', past],
    );

    // Reading the room triggers `update ... set status='closed' where end_time <= now()`.
    const r = await fetchJson(`/api/rooms/${roomId}`);
    const byId = Object.fromEntries(r.json.markets.map((m) => [m.id, m.status]));
    assert.equal(byId[expiredId], 'closed', 'expired market is closed by the sweep');
    assert.equal(byId[open.id], 'open', 'the not-yet-expired market stays open');
  });

  it('the room surfaces an OPEN market ahead of a closed one (Room.jsx uses markets[0])', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const UA = await auth(fetchJson, A);
    const roomId = await createRoom(fetchJson, UA);

    // Put an EXPIRED/closed market in first (older), then create a fresh open one (newer).
    const expiredId = randomUUID();
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, start_time, end_time, resolution_time, yes_price, no_price, status)
       values($1,$2,$3,'sim',$4,'rule','{https://x}','gaming',$5,$5,$5,0.5,0.5,'closed')`,
      [expiredId, roomId, UA.id, 'Closed market that should not be the active one', past],
    );
    const open = await createMarket(fetchJson, UA, roomId, 'Fresh open market should be active?', 10);

    const r = await fetchJson(`/api/rooms/${roomId}`);
    assert.equal(r.json.markets[0].id, open.id, 'markets[0] (the active market in the UI) must be the open one');

    // The hero market on the discover list must also prefer the open market.
    const list = await fetchJson('/api/rooms');
    const mine = list.json.find((x) => x.id === roomId);
    assert.equal(mine.heroMarket.id, open.id, 'discover hero must be the open market, not the closed one');
  });
});
