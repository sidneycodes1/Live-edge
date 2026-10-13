import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb, acceptTerms } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  await acceptTerms(fetchJson, v.json.token);
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function createRoom(fetchJson, U, title) {
  const r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title }), headers: { Authorization: `Bearer ${U.token}` } });
  return r.json.id;
}

async function createMarket(fetchJson, U, roomId, question) {
  let r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'], endInMinutes: 10 }), headers: { Authorization: `Bearer ${U.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${U.token}` } });
  const sig = signObj(U.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
  return r.json.id;
}

async function buy(fetchJson, U, marketId, side, amount) {
  let r = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
  const oid = r.json.orderId;
  r = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
  const sig = signObj(U.kp, r.json.signPayload);
  return fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
}

describe('GET /api/portfolio/history & Live tab segregation', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('correctly categorizes cashed, won, and lost positions into History, leaving only open in Live', async () => {
    const { fetchJson } = await makeApp();
    const creator = await auth(fetchJson, genWallet());
    const trader = await auth(fetchJson, genWallet());

    const roomId = await createRoom(fetchJson, creator, 'History Test Room');

    // Market 1: Cashed out
    const mCashed = await createMarket(fetchJson, creator, roomId, 'Will trader cash out?');
    await buy(fetchJson, trader, mCashed, 'yes', 20);
    const cashRes = await fetchJson('/api/orders/cashout', {
      method: 'POST',
      body: JSON.stringify({ marketId: mCashed }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(cashRes.res.status, 200, 'cashout succeeded');
    const cashProceeds = Number(cashRes.json.proceeds);

    // Market 2: Won & claimed
    const mWon = await createMarket(fetchJson, creator, roomId, 'Will trader win and claim?');
    await buy(fetchJson, trader, mWon, 'yes', 15);
    // Resolve YES
    await fetchJson(`/api/markets/${mWon}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'yes', force: true }),
      headers: { Authorization: `Bearer ${creator.token}` },
    });
    // Claim win
    let cRes = await fetchJson('/api/claims/win/build', {
      method: 'POST',
      body: JSON.stringify({ marketId: mWon }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    const cSig = signObj(trader.kp, cRes.json.signPayload);
    const claimSubmit = await fetchJson('/api/claims/win', {
      method: 'POST',
      body: JSON.stringify({ marketId: mWon, signature: cSig }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(claimSubmit.res.status, 200, 'claim win succeeded');

    // Market 3: Lost
    const mLost = await createMarket(fetchJson, creator, roomId, 'Will trader lose this bet?');
    await buy(fetchJson, trader, mLost, 'yes', 10);
    // Resolve NO
    await fetchJson(`/api/markets/${mLost}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'no', force: true }),
      headers: { Authorization: `Bearer ${creator.token}` },
    });

    // Market 4: Still open, active position
    const mOpen = await createMarket(fetchJson, creator, roomId, 'Will this bet stay open and active?');
    await buy(fetchJson, trader, mOpen, 'yes', 25);

    // 1) Verify Live tab: GET /api/portfolio
    const { json: livePortfolio } = await fetchJson('/api/portfolio', {
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(livePortfolio.positions.length, 1, 'Live tab has exactly 1 open position');
    assert.equal(livePortfolio.positions[0].market.id, mOpen, 'Live position is mOpen');
    assert.equal(livePortfolio.positions[0].invested, 25, 'invested is 25');
    assert.ok(livePortfolio.positions[0].currentValue > 0, 'currentValue > 0');

    // 2) Verify History tab: GET /api/portfolio/history
    const { json: hist } = await fetchJson('/api/portfolio/history', {
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(hist.total, 3, 'History total is 3');
    assert.equal(hist.items.length, 3, 'History returns 3 items');

    const cashedItem = hist.items.find((h) => h.market.id === mCashed);
    assert.ok(cashedItem, 'cashed item present');
    assert.equal(cashedItem.outcome, 'cashed', 'outcome is cashed');
    assert.equal(cashedItem.invested, 20, 'invested is 20');
    assert.equal(cashedItem.proceeds, cashProceeds, 'proceeds match cashout');
    assert.equal(cashedItem.realizedPnl, cashProceeds - 20, 'realizedPnl is proceeds - invested');

    const wonItem = hist.items.find((h) => h.market.id === mWon);
    assert.ok(wonItem, 'won item present');
    assert.equal(wonItem.outcome, 'won', 'outcome is won');
    assert.equal(wonItem.invested, 15, 'invested is 15');
    assert.ok(wonItem.proceeds > 0, 'won proceeds > 0');

    const lostItem = hist.items.find((h) => h.market.id === mLost);
    assert.ok(lostItem, 'lost item present');
    assert.equal(lostItem.outcome, 'lost', 'outcome is lost');
    assert.equal(lostItem.invested, 10, 'invested is 10');
    assert.equal(lostItem.proceeds, 0, 'lost proceeds is 0');
    assert.equal(lostItem.realizedPnl, -10, 'realizedPnl is -10');

    // 3) Pagination test
    const { json: paged } = await fetchJson('/api/portfolio/history?limit=2&offset=0', {
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(paged.items.length, 2, 'paged returns 2 items');
    assert.equal(paged.total, 3, 'paged total is 3');
  });
});
