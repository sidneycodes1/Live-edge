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

async function createRoom(fetchJson, U) {
  const r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Fee Room' }), headers: { Authorization: `Bearer ${U.token}` } });
  return r.json.id;
}

// Full quote -> build -> sign -> register, returning each step so we can assert the fee.
async function createMarketSteps(fetchJson, U, roomId, question) {
  const quote = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'], endInMinutes: 10 }), headers: { Authorization: `Bearer ${U.token}` } });
  const q = quote.json.quoteId;
  const build = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${U.token}` } });
  const sig = signObj(U.kp, build.json.signPayload);
  const register = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
  return { quote, q, register };
}

async function getBalance(fetchJson, U) {
  const p = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${U.token}` } });
  return Number(p.json.balance);
}

describe('creation fee (F-010 / T5, Phase 3.1)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('quotes a fee, deducts exactly it, and records a ledger row', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await auth(fetchJson, genWallet());
    const roomId = await createRoom(fetchJson, U);
    const balBefore = await getBalance(fetchJson, U);

    const { quote, register } = await createMarketSteps(fetchJson, U, roomId, 'Fee deducted test?');
    assert.equal(quote.res.status, 200);
    const fee = Number(quote.json.fee);
    assert.ok(fee > 0, 'a positive fee must be quoted');
    assert.equal(register.res.status, 201, JSON.stringify(register.json));

    const balAfter = await getBalance(fetchJson, U);
    assert.equal(Number((balBefore - balAfter).toFixed(6)), fee, 'balance must drop by exactly the quoted fee');

    // Journal row exists.
    const { rows: fe } = await db.query(`select amount from fee_events where user_id=$1 and kind='creation_fee'`, [U.id]);
    assert.equal(fe.length, 1);
    assert.equal(Number(fe[0].amount), fee);

    // Ledger surfaces it as a negative "Creation fee" delta.
    const led = await fetchJson('/api/ledger', { headers: { Authorization: `Bearer ${U.token}` } });
    const feeRow = led.json.items.find((i) => i.kind === 'creation_fee');
    assert.ok(feeRow, 'ledger should include the creation fee');
    assert.equal(feeRow.label, 'Creation fee');
    assert.equal(feeRow.delta, -fee);

    // Sum of every ledger delta equals the live balance (single source of truth).
    const sum = led.json.items.reduce((a, i) => a + i.delta, 0);
    assert.equal(Number(sum.toFixed(6)), balAfter);
  });

  it('blocks creation with a clear insufficient-balance error (no market, no charge)', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await auth(fetchJson, genWallet());
    const roomId = await createRoom(fetchJson, U);
    // Drain the balance below the fee directly (test setup, not the code path under test).
    await db.query('update balances set sim_usdc = 0.5 where user_id=$1', [U.id]);
    const balBefore = await getBalance(fetchJson, U);
    assert.equal(balBefore, 0.5);

    const { quote, register } = await createMarketSteps(fetchJson, U, roomId, 'Insufficient fee test?');
    const fee = Number(quote.json.fee);
    assert.ok(fee > 0.5, 'fee should exceed the drained balance for this test');
    assert.equal(register.res.status, 400);
    assert.equal(register.json.error.code, 'INSUFFICIENT_BALANCE');
    assert.match(register.json.error.message, /creation fee/i, 'error must name the creation fee, not be generic');

    // Nothing was created and no fee was journaled or deducted.
    const { rows: mk } = await db.query('select id from markets where creator_id=$1 and question=$2', [U.id, 'Insufficient fee test?']);
    assert.equal(mk.length, 0, 'market must not be created');
    const { rows: fe } = await db.query(`select id from fee_events where user_id=$1`, [U.id]);
    assert.equal(fe.length, 0);
    assert.equal(await getBalance(fetchJson, U), balBefore, 'balance must be unchanged');
  });
});
