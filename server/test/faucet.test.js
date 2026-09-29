import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  return { token: v.json.token, pub: W.pub, id: v.json.user.id };
}

describe('faucet', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('adds $100 to the welcome balance (100 -> 200), does not overwrite', async () => {
    const { fetchJson, db } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    const r = await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(r.res.status, 200);
    assert.equal(Number(r.json.balance), 200);
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [U.id]);
    assert.equal(Number(rows[0].sim_usdc), 200);
  });

  it('keeps a balance above $100 and adds the faucet amount (F-007 regression)', async () => {
    const { fetchJson, db } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    // Raise the balance to 250 and clear the cooldown so the faucet is eligible.
    await db.query('update balances set sim_usdc=250, last_faucet_at=null where user_id=$1', [U.id]);
    const r = await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(r.res.status, 200);
    assert.equal(Number(r.json.balance), 350, 'a 250 balance must become 350, never knocked down to 100');
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [U.id]);
    assert.equal(Number(rows[0].sim_usdc), 350);
  });

  it('enforces the 1h cooldown on a second immediate claim', async () => {
    const { fetchJson, db } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    const first = await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(first.res.status, 200);
    const second = await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(second.res.status, 429);
    assert.equal(second.json.error.code, 'RATE_LIMITED');
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [U.id]);
    assert.equal(Number(rows[0].sim_usdc), 200, 'cooldown rejection must not change the balance');
  });
});
