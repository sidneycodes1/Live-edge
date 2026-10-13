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

describe('POST /api/orders/cashout', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('cashout sells position, restores funds at honest LMSR price, and records sell trade', async () => {
    const { fetchJson, db } = await makeApp();
    const creator = await auth(fetchJson, genWallet());
    const trader = await auth(fetchJson, genWallet());

    const roomId = await createRoom(fetchJson, creator, 'Cashout Room');
    const marketId = await createMarket(fetchJson, creator, roomId, 'Will the price rise?');

    // Trader initial balance is 100
    const buyRes = await buy(fetchJson, trader, marketId, 'yes', 20);
    assert.equal(buyRes.res.status, 200, 'buy succeeded');

    const { rows: b1 } = await db.query('select sim_usdc from balances where user_id=$1', [trader.id]);
    assert.equal(Number(b1[0].sim_usdc), 80, 'trader balance is 80 after spending 20');

    const { rows: pos1 } = await db.query('select * from positions where user_id=$1 and market_id=$2', [trader.id, marketId]);
    const yesSharesBought = Number(pos1[0].yes_shares);
    assert.ok(yesSharesBought > 0, 'trader has yes shares');

    // Market q_yes increased
    const { rows: m1 } = await db.query('select * from markets where id=$1', [marketId]);
    assert.equal(Number(m1[0].q_yes), yesSharesBought, 'market q_yes increased by shares');

    // Execute cashout
    const cashRes = await fetchJson('/api/orders/cashout', {
      method: 'POST',
      body: JSON.stringify({ marketId }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(cashRes.res.status, 200, 'cashout succeeded: ' + JSON.stringify(cashRes.json));
    const proceeds = Number(cashRes.json.proceeds);
    assert.ok(proceeds > 0, 'proceeds is positive');

    // Balances increased by proceeds
    const { rows: b2 } = await db.query('select sim_usdc from balances where user_id=$1', [trader.id]);
    assert.equal(Number(b2[0].sim_usdc), Number((80 + proceeds).toFixed(6)), 'balance restored by proceeds');

    // Position shares become 0
    const { rows: pos2 } = await db.query('select * from positions where user_id=$1 and market_id=$2', [trader.id, marketId]);
    assert.equal(Number(pos2[0].yes_shares), 0, 'yes_shares set to 0');
    assert.equal(Number(pos2[0].no_shares), 0, 'no_shares is 0');

    // Market q_yes returned to 0
    const { rows: m2 } = await db.query('select * from markets where id=$1', [marketId]);
    assert.equal(Number(m2[0].q_yes), 0, 'market q_yes returned to 0');

    // Trade row created with kind='sell'
    const { rows: sellTrades } = await db.query('select * from trades where user_id=$1 and market_id=$2 and kind=$3', [trader.id, marketId, 'sell']);
    assert.equal(sellTrades.length, 1, 'one sell trade inserted');
    assert.equal(sellTrades[0].side, 'yes', 'sell trade side is yes');
    assert.equal(Number(sellTrades[0].amount), proceeds, 'sell trade amount matches proceeds');
    assert.equal(Number(sellTrades[0].shares), yesSharesBought, 'sell trade shares match bought shares');
  });

  it('cashout refuses closed markets with 409 MARKET_NOT_OPEN', async () => {
    const { fetchJson, db } = await makeApp();
    const creator = await auth(fetchJson, genWallet());
    const trader = await auth(fetchJson, genWallet());

    const roomId = await createRoom(fetchJson, creator, 'Closed Market Room');
    const marketId = await createMarket(fetchJson, creator, roomId, 'Will this close soon?');
    await buy(fetchJson, trader, marketId, 'yes', 10);

    // Close market
    await db.query(`update markets set status='closed' where id=$1`, [marketId]);

    const cashRes = await fetchJson('/api/orders/cashout', {
      method: 'POST',
      body: JSON.stringify({ marketId }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(cashRes.res.status, 409, 'cashout refused on closed market');
    assert.equal(cashRes.json.error.code, 'MARKET_NOT_OPEN');
  });

  it('cashout refuses if user has no position with 400 NO_POSITION', async () => {
    const { fetchJson } = await makeApp();
    const creator = await auth(fetchJson, genWallet());
    const trader = await auth(fetchJson, genWallet());

    const roomId = await createRoom(fetchJson, creator, 'No Pos Room');
    const marketId = await createMarket(fetchJson, creator, roomId, 'Will anyone bet?');

    const cashRes = await fetchJson('/api/orders/cashout', {
      method: 'POST',
      body: JSON.stringify({ marketId }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(cashRes.res.status, 400, 'cashout refused with no position');
    assert.equal(cashRes.json.error.code, 'NO_POSITION');
  });

  it('cashout handles holding both sides, sums proceeds, and inserts trades per side', async () => {
    const { fetchJson, db } = await makeApp();
    const creator = await auth(fetchJson, genWallet());
    const trader = await auth(fetchJson, genWallet());

    const roomId = await createRoom(fetchJson, creator, 'Both Sides Room');
    const marketId = await createMarket(fetchJson, creator, roomId, 'Will both sides be bought?');

    await buy(fetchJson, trader, marketId, 'yes', 10);
    await buy(fetchJson, trader, marketId, 'no', 10);

    const cashRes = await fetchJson('/api/orders/cashout', {
      method: 'POST',
      body: JSON.stringify({ marketId }),
      headers: { Authorization: `Bearer ${trader.token}` },
    });
    assert.equal(cashRes.res.status, 200, 'cashout on both sides succeeded');
    const proceeds = Number(cashRes.json.proceeds);
    assert.ok(proceeds > 0, 'proceeds is positive');

    const { rows: sellTrades } = await db.query('select * from trades where user_id=$1 and market_id=$2 and kind=$3', [trader.id, marketId, 'sell']);
    assert.equal(sellTrades.length, 2, 'two sell trades inserted for both sides');
    const totalSoldAmount = sellTrades.reduce((acc, t) => acc + Number(t.amount), 0);
    assert.equal(Number(totalSoldAmount.toFixed(6)), proceeds, 'total sold amounts equal proceeds');
  });
});
