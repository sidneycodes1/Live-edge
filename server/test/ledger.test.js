import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';
import { round6 } from '../src/sim/lmsr.js';

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function createMarket(fetchJson, UA, question, endInMinutes = 10) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Ledger Room' }), headers: { Authorization: `Bearer ${UA.token}` } });
  const roomId = r.json.id;
  r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'], endInMinutes }), headers: { Authorization: `Bearer ${UA.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${UA.token}` } });
  const sigM = signObj(UA.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sigM }), headers: { Authorization: `Bearer ${UA.token}` } });
  return r.json.id;
}

async function getMarketStatus(fetchJson, id) {
  const r = await fetchJson(`/api/markets/${id}`);
  return r.json.status;
}

async function buy(fetchJson, U, marketId, side, amount) {
  let r = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
  const oid = r.json.orderId;
  const quoted = r.json;
  r = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
  const sigO = signObj(U.kp, r.json.signPayload);
  r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: sigO }), headers: { Authorization: `Bearer ${U.token}` } });
  return { submit: r, quoted };
}

describe('ledger', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('auth and balance check', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(port.res.status, 200);
    assert.equal(Number(port.json.balance), 100);
  });

  it('balance after successful trade', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Trade test ledger?');
    const { submit } = await buy(fetchJson, UB, marketId, 'yes', 10);
    assert.equal(submit.res.status, 200);
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${UB.token}` } });
    assert.ok(Number(port.json.balance) < 100);
    assert.ok(Number(port.json.balance) > 0);
  });

  it('fee exact math scenario 1: amount 10 -> fee 0.2', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Fee math one ledger?');
    const { quoted, submit } = await buy(fetchJson, UB, marketId, 'yes', 10);
    assert.equal(submit.res.status, 200);
    const expectedFee = round6((10 * 200) / 10000);
    assert.equal(expectedFee, 0.2);
    assert.equal(Number(quoted.fee), expectedFee);
    const { rows } = await db.query('select fee, amount from orders where market_id=$1', [marketId]);
    assert.equal(Number(rows[0].fee), 0.2);
    assert.equal(Number(rows[0].amount), 10);
  });

  it('fee exact math scenario 2: amount 5 -> fee 0.1, creator share 0.025', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Fee math two ledger?');
    const { quoted, submit } = await buy(fetchJson, UB, marketId, 'yes', 5);
    assert.equal(submit.res.status, 200);
    const expectedFee = round6((5 * 200) / 10000);
    const expectedShare = round6((expectedFee * 2500) / 10000);
    assert.equal(expectedFee, 0.1);
    assert.equal(expectedShare, 0.025);
    assert.equal(Number(quoted.fee), 0.1);
    const { rows } = await db.query('select creator_fees_accrued from markets where id=$1', [marketId]);
    assert.equal(Number(rows[0].creator_fees_accrued), expectedShare);
  });

  it('fee exact math scenario 3: amount 33.33 -> 6-decimal rounding', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Fee math three ledger?');
    const { quoted, submit } = await buy(fetchJson, UB, marketId, 'no', 33.33);
    assert.equal(submit.res.status, 200);
    const expectedFee = round6((33.33 * 200) / 10000);
    const expectedShare = round6((expectedFee * 2500) / 10000);
    assert.equal(Number(quoted.fee.toFixed(6)), Number(expectedFee.toFixed(6)));
    const { rows: oRows } = await db.query('select fee from orders where market_id=$1', [marketId]);
    assert.equal(Number(Number(oRows[0].fee).toFixed(6)), Number(expectedFee.toFixed(6)));
    const { rows: mRows } = await db.query('select creator_fees_accrued from markets where id=$1', [marketId]);
    assert.equal(Number(Number(mRows[0].creator_fees_accrued).toFixed(6)), Number(expectedShare.toFixed(6)));
  });

  it('balance debited exactly by amount (DB state)', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Exact debit ledger?');
    await buy(fetchJson, UB, marketId, 'yes', 5);
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [UB.id]);
    assert.equal(Number(rows[0].sim_usdc), 95);
  });

  it('volume accrues exactly by amount (DB state)', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Volume accrual ledger?');
     await buy(fetchJson, UB, marketId, 'yes', 7);
     const { rows } = await db.query('select volume from markets where id=$1', [marketId]);
     assert.equal(Number(rows[0].volume), 7);
   });

it('market stays open after creation with 10-minute duration', async () => {
     const { fetchJson, db } = await makeApp();
     const A = genWallet();
     const UA = await auth(fetchJson, A);
     const marketId = await createMarket(fetchJson, UA, 'Market lifecycle test?', 10);
     const status = await getMarketStatus(fetchJson, marketId);
     assert.equal(status, 'open');
     const { rows } = await db.query('select status, end_time from markets where id=$1', [marketId]);
     assert.equal(rows[0].status, 'open');
   });
   it('two sequential buys debit cumulatively', async () => {
     const { fetchJson, db } = await makeApp();
     const A = genWallet();
     const B = genWallet();
     const UA = await auth(fetchJson, A);
     const UB = await auth(fetchJson, B);
     const marketId = await createMarket(fetchJson, UA, 'Cumulative debit ledger?');
     await buy(fetchJson, UB, marketId, 'yes', 5);
     await buy(fetchJson, UB, marketId, 'no', 8);
     const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [UB.id]);
     assert.equal(Number(rows[0].sim_usdc), 87);
   });
 });
