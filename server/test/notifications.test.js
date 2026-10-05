import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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

async function createMarket(fetchJson, UA, question) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Notif Room' }), headers: { Authorization: `Bearer ${UA.token}` } });
  const roomId = r.json.id;
  r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'] }), headers: { Authorization: `Bearer ${UA.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${UA.token}` } });
  const sigM = signObj(UA.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sigM }), headers: { Authorization: `Bearer ${UA.token}` } });
  return r.json.id;
}

async function buy(fetchJson, U, marketId, side, amount) {
  let r = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
  const oid = r.json.orderId;
  r = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
  const sigO = signObj(U.kp, r.json.signPayload);
  r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: sigO }), headers: { Authorization: `Bearer ${U.token}` } });
  return r;
}

async function buildSignClaim(fetchJson, U, marketId) {
  const b = await fetchJson('/api/claims/win/build', { method: 'POST', body: JSON.stringify({ marketId }), headers: { Authorization: `Bearer ${U.token}` } });
  return signObj(U.kp, b.json.signPayload);
}

function kinds(items) {
  return items.map((i) => i.kind);
}

describe('notification center (F-005)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('requires auth', async () => {
    const { fetchJson } = await makeApp();
    const r = await fetchJson('/api/notifications');
    assert.equal(r.res.status, 401);
  });

  it('welcome + faucet produce notifications owned by the right user', async () => {
    const { fetchJson, db } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    let list = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.ok(kinds(list.json.items).includes('welcome'));

    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    list = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.ok(kinds(list.json.items).includes('faucet'));

    // assert the faucet row belongs to THIS user
    const { rows } = await db.query(`select user_id from notifications where kind='faucet' and user_id=$1`, [U.id]);
    assert.equal(rows.length, 1);
  });

  it('created/resolved/payout/claim events fire for the correct users', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);

    const marketId = await createMarket(fetchJson, UA, 'Notification full flow test?');
    let aList = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${UA.token}` } });
    assert.ok(kinds(aList.json.items).includes('market_created'));

    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });

    // holder B (winning) should now have market_resolved AND payout_available
    let bList = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${UB.token}` } });
    const bk = kinds(bList.json.items);
    assert.ok(bk.includes('market_resolved'), 'expected market_resolved for holder');
    assert.ok(bk.includes('payout_available'), 'expected payout_available for winner');

    // the creator (no position) must NOT have received a payout notification
    aList = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${UA.token}` } });
    assert.ok(!kinds(aList.json.items).includes('payout_available'), 'creator without position should not get payout');

    // B claims win -> claim_completed
    const sig = await buildSignClaim(fetchJson, UB, marketId);
    const c = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(c.res.status, 200);
    bList = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${UB.token}` } });
    assert.ok(kinds(bList.json.items).includes('claim_completed'));

    // verify the claim_completed row is owned by B
    const { rows } = await db.query(`select user_id from notifications where kind='claim_completed'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, UB.id);
  });

  it('unread filter + mark-all-read drops the unread count', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });

    let unread = await fetchJson('/api/notifications?unread=1', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.ok(unread.json.items.length >= 2);
    assert.ok(unread.json.unreadCount >= 2);

    const read = await fetchJson('/api/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }), headers: { Authorization: `Bearer ${U.token}` } });
    assert.ok(read.json.updated >= 2);
    assert.equal(read.json.unreadCount, 0);

    unread = await fetchJson('/api/notifications?unread=1', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(unread.json.items.length, 0);
    assert.equal(unread.json.unreadCount, 0);

    // the full (non-unread) history is still present
    const all = await fetchJson('/api/notifications', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.ok(all.json.items.length >= 2);
  });
});
