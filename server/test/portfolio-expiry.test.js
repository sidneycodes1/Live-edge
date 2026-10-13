import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb, acceptTerms } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

// ---------------------------------------------------------------------------
// Portfolio EXPIRY (owner correction, Oct 2026): a bet must simply DISAPPEAR
// from the active lists once its end_time passes — the reporter created markets
// with a 30-minute window and still saw them a day later. The 10s background
// loop + the room/market read paths already flip past-end_time 'open' markets to
// 'closed'; the gap was that /api/portfolio never swept on read AND returned
// positions/createdMarkets regardless of status, so closed rows lingered. These
// tests pin BOTH halves: (1) expiry hides a closed market from positions and the
// created list, and (2) a resolved market stays visible (winnings remain claimable).
// ---------------------------------------------------------------------------

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  const terms = await acceptTerms(fetchJson, v.json.token);
  if (terms.res.status !== 200) throw new Error('acceptTerms fixture failed: ' + JSON.stringify(terms.json));
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function createMarket(fetchJson, UA, question) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Expiry Room' }), headers: { Authorization: `Bearer ${UA.token}` } });
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

const portfolio = async (fetchJson, U) => (await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${U.token}` } })).json;

describe('portfolio expiry', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('hides a past-end_time market from both positions and created lists', async () => {
    const { fetchJson, db } = await makeApp();
    const UA = await auth(fetchJson, genWallet()); // creator
    const UB = await auth(fetchJson, genWallet()); // bettor
    const marketId = await createMarket(fetchJson, UA, 'Will this expire quietly?');
    await buy(fetchJson, UB, marketId, 'yes', 10);

    // While open, both surfaces show it.
    const openA = await portfolio(fetchJson, UA);
    const openB = await portfolio(fetchJson, UB);
    assert.ok(openA.createdMarkets.some((m) => m.market.id === marketId), 'creator sees open market');
    assert.ok(openB.positions.some((p) => p.market.id === marketId), 'bettor sees open position');

    // Time-travel: push end_time a minute into the past.
    await db.query(`update markets set end_time = now() - interval '1 minute' where id=$1`, [marketId]);

    // A portfolio read sweeps on the spot, so it is closed immediately…
    const after = await portfolio(fetchJson, UA);
    assert.ok(!after.createdMarkets.some((m) => m.market.id === marketId), 'expired market gone from created list');
    const afterB = await portfolio(fetchJson, UB);
    assert.ok(!afterB.positions.some((p) => p.market.id === marketId), 'expired position gone from active list');

    // …and truly closed in the DB (not merely hidden).
    const { rows } = await db.query('select status from markets where id=$1', [marketId]);
    assert.equal(rows[0].status, 'closed');
  });

  it('keeps a resolved position visible so winnings stay claimable', async () => {
    const { fetchJson } = await makeApp();
    const UA = await auth(fetchJson, genWallet());
    const UB = await auth(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, UA, 'Resolved stays visible?');
    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });

    const afterB = await portfolio(fetchJson, UB);
    const row = afterB.positions.find((p) => p.market.id === marketId);
    assert.ok(row, 'resolved position still listed');
    assert.equal(row.market.status, 'resolved');
    assert.equal(row.claimable, true);
  });

  // --- s8: in-play value + settle/loss read off REAL trades + resolution ------
  it('s8: an OPEN position exposes the real cost basis and unrealized P/L (no settlement yet)', async () => {
    const { fetchJson } = await makeApp();
    const UA = await auth(fetchJson, genWallet());
    const UB = await auth(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, UA, 'Open in-play value?');
    await buy(fetchJson, UB, marketId, 'yes', 10);

    const row = (await portfolio(fetchJson, UB)).positions.find((p) => p.market.id === marketId);
    assert.equal(row.invested, 10, 'cost basis = the buy amount actually paid');
    assert.ok(Number.isFinite(row.currentValue), 'mark-to-market value is a number');
    assert.ok(Math.abs(row.unrealizedPnl - (row.currentValue - 10)) < 1e-9, 'unrealized P/L = value − cost');
    assert.equal(row.settlement, null, 'an open bet has no settlement');
  });

  it('s8: a resolved WIN reports the payout (winning shares), not the stale price', async () => {
    const { fetchJson } = await makeApp();
    const UA = await auth(fetchJson, genWallet());
    const UB = await auth(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, UA, 'Settles yes?');
    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });

    const row = (await portfolio(fetchJson, UB)).positions.find((p) => p.market.id === marketId);
    assert.equal(row.unrealizedPnl, null, 'resolved bets have no unrealized P/L');
    assert.equal(row.settlement.outcome, 'yes');
    assert.equal(row.settlement.won, true);
    assert.equal(row.settlement.payout, row.yesShares, 'payout is the winning side shares');
    assert.ok(row.settlement.payout > 0);
    assert.ok(Math.abs(row.settlement.realizedPnl - (row.settlement.payout - 10)) < 1e-9);
  });

  it('s8: a resolved LOSS reports a $0 payout and a negative realized P/L', async () => {
    const { fetchJson } = await makeApp();
    const UA = await auth(fetchJson, genWallet());
    const UB = await auth(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, UA, 'Settles no against me?');
    await buy(fetchJson, UB, marketId, 'yes', 10);
    await fetchJson(`/api/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'no', force: true }), headers: { Authorization: `Bearer ${UA.token}` } });

    // History contract (Oct 2026): a resolved loss is FINAL — nothing to claim —
    // so it leaves the Live tab and lives in /api/portfolio/history, honestly
    // tagged lost with the whole stake as the loss.
    const live = (await portfolio(fetchJson, UB)).positions.find((p) => p.market.id === marketId);
    assert.equal(live, undefined, 'a resolved loss does not linger in Live positions');

    const { json: hist } = await fetchJson('/api/portfolio/history', { headers: { Authorization: `Bearer ${UB.token}` } });
    const item = hist.items.find((h) => h.market.id === marketId);
    assert.ok(item, 'the loss appears in History');
    assert.equal(item.outcome, 'lost');
    assert.equal(item.proceeds, 0, 'losing side pays nothing');
    assert.equal(item.invested, 10, 'cost basis = the buy amount actually paid');
    assert.equal(item.realizedPnl, -10, 'the whole stake is the honest loss');
  });
});

