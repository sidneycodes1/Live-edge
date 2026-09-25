import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function createMarket(fetchJson, UA, question) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Claims Room' }), headers: { Authorization: `Bearer ${UA.token}` } });
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

async function buildSignClaim(fetchJson, U, marketId, kind) {
  const path = kind === 'creator' ? '/api/claims/creator-fees/build' : '/api/claims/win/build';
  const b = await fetchJson(path, { method: 'POST', body: JSON.stringify({ marketId }), headers: { Authorization: `Bearer ${U.token}` } });
  assert.equal(b.res.status, 200);
  return signObj(U.kp, b.json.signPayload);
}

describe('claims', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('portfolio returns balance', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(port.res.status, 200);
    assert.ok(port.json.balance !== undefined);
  });

  it('claim win happy path', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Claim market test claims?');
    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });
    const sig = await buildSignClaim(fetchJson, UB, marketId, 'win');
    const r = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(r.res.status, 200);
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${UB.token}` } });
    assert.ok(Number(port.json.balance) > 90);
  });

  it('double claim NOT_CLAIMABLE', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Double claim test claims?');
    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });
    const sig = await buildSignClaim(fetchJson, UB, marketId, 'win');
    const first = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(first.res.status, 200);
    // rebuild (new nonce) then submit -> position already claimed
    const sig2 = await buildSignClaim(fetchJson, UB, marketId, 'win');
    const r = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig2 }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(r.json.error.code, 'NOT_CLAIMABLE');
  });

  it('loser cannot claim', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Loser test claims case?');
    await buy(fetchJson, UB, marketId, 'no', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });
    const sig = await buildSignClaim(fetchJson, UB, marketId, 'win');
    const r = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(r.json.error.code, 'NOT_CLAIMABLE');
  });

  it('creator fee not graduated fails', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Creator fee test claims?');
    await buy(fetchJson, UB, marketId, 'yes', 5);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });
    const sig = await buildSignClaim(fetchJson, UA, marketId, 'creator');
    const r = await fetchJson('/api/claims/creator-fees', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${UA.token}` } });
    assert.equal(r.json.error.code, 'MARKET_NOT_GRADUATED');
  });

  it('creator fee claim after graduation', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Graduated test claims case?');
    for (let i = 0; i < 12; i++) {
      await buy(fetchJson, UB, marketId, 'yes', 10);
      // UB runs out after 10x10=100; top up via direct DB credit for test determinism
      if (i === 9) await db.query('update balances set sim_usdc = sim_usdc + 100 where user_id=$1', [UB.id]);
    }
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });
    const { rows } = await db.query('select graduated, creator_fees_accrued from markets where id=$1', [marketId]);
    assert.equal(rows[0].graduated, true);
    assert.ok(Number(rows[0].creator_fees_accrued) > 0);
    const sig = await buildSignClaim(fetchJson, UA, marketId, 'creator');
    const r = await fetchJson('/api/claims/creator-fees', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${UA.token}` } });
    assert.equal(r.res.status, 200);
  });

  it('graduation threshold: volume 100 graduates, 5 does not', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const smallId = await createMarket(fetchJson, UA, 'Small graduation threshold?');
    await buy(fetchJson, UB, smallId, 'yes', 5);
    const { rows: sRows } = await db.query('select graduated, volume from markets where id=$1', [smallId]);
    assert.equal(sRows[0].graduated, false);
    assert.equal(Number(sRows[0].volume), 5);
  });

  it('claim without build fails INVALID_SIGNATURE', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Claim without build test?');
    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });
    // Sign arbitrary payload without calling build -> no stored nonce
    const fakeSig = signObj(UB.kp, { kind: 'claim_win', marketId, wallet: UB.pub, nonce: 'never-issued' });
    const r = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: fakeSig }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, 'INVALID_SIGNATURE');
  });
});
