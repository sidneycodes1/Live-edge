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

async function createMarket(fetchJson, U, question) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Ledger History Room' }), headers: { Authorization: `Bearer ${U.token}` } });
  const roomId = r.json.id;
  r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'] }), headers: { Authorization: `Bearer ${U.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${U.token}` } });
  const sigM = signObj(U.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sigM }), headers: { Authorization: `Bearer ${U.token}` } });
  return r.json.id;
}

async function buy(fetchJson, U, marketId, side, amount) {
  let r = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
  const oid = r.json.orderId;
  r = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
  const sigO = signObj(U.kp, r.json.signPayload);
  return fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: sigO }), headers: { Authorization: `Bearer ${U.token}` } });
}

async function claimWin(fetchJson, U, marketId) {
  const b = await fetchJson('/api/claims/win/build', { method: 'POST', body: JSON.stringify({ marketId }), headers: { Authorization: `Bearer ${U.token}` } });
  const sig = signObj(U.kp, b.json.signPayload);
  return fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
}

async function ledger(fetchJson, U, qs = '') {
  return fetchJson(`/api/ledger${qs}`, { headers: { Authorization: `Bearer ${U.token}` } });
}

describe('ledger history (GET /api/ledger)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('requires auth', async () => {
    const { fetchJson } = await makeApp();
    const r = await fetchJson('/api/ledger');
    assert.equal(r.res.status, 401);
  });

  it('lists welcome + faucet + trade + claim in chronological order with correct signs', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W); // welcome mint (+100)

    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } }); // faucet mint (+100)

    const marketId = await createMarket(fetchJson, U, 'Ledger history happy path?');
    await buy(fetchJson, U, marketId, 'yes', 5); // trade (debit)
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${U.token}` } });
    const claim = await claimWin(fetchJson, U, marketId); // claim (credit)
    assert.equal(claim.res.status, 200);

    const { json } = await ledger(fetchJson, U);
    const kinds = json.items.map((i) => i.kind);
    // Newest first: claim, then buy, then faucet, then welcome.
    assert.deepEqual(kinds, ['claim', 'buy', 'faucet', 'welcome']);

    // Correct signs: spends negative, mints/earnings positive.
    const byKind = Object.fromEntries(json.items.map((i) => [i.kind, i]));
    assert.ok(byKind.buy.delta < 0, 'buy should debit');
    assert.equal(byKind.buy.delta, -5);
    assert.ok(byKind.claim.delta > 0, 'claim should credit');
    assert.equal(byKind.faucet.delta, 100);
    assert.equal(byKind.welcome.delta, 100);

    // Sum of all deltas must equal the live balance (single source, no drift).
    const sum = json.items.reduce((a, i) => a + i.delta, 0);
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(Number(sum.toFixed(6)), Number(port.json.balance));
  });

  it('paginates with limit and offset', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const U = await auth(fetchJson, W);
    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });

    const page1 = await ledger(fetchJson, U, '?limit=1');
    assert.equal(page1.json.items.length, 1);
    assert.equal(page1.json.hasMore, true);
    // Most recent first is the faucet mint.
    assert.equal(page1.json.items[0].kind, 'faucet');

    const page2 = await ledger(fetchJson, U, '?limit=1&offset=1');
    assert.equal(page2.json.items.length, 1);
    assert.equal(page2.json.items[0].kind, 'welcome');
  });
});
