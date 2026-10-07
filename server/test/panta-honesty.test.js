import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb, acceptTerms } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';
import { createPantaSync } from '../src/services/pantaSync.js';

// Door 1 honesty + conservation contract (plan Phase 6).
//
//   1. A real Panta price is owned by the POLLER, not our fake bets: betting a
//      'panta_live' market moves the LEDGER (q_yes/q_no/volume) but NEVER the
//      displayed price, and it stays labeled 'panta_live'.
//   2. Where there is no live Panta quote, our own play-money bets MAY move the
//      displayed price, but only inside the SIM_DRIFT_MAX_BPS band and always
//      relabeled 'simulated' — a simulated number never masquerades as Panta (§5).
//   3. Betting a Panta market uses the SAME fake ledger, so the money-conservation
//      invariant is untouched.

const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
const now = () => T0;
const MICRO = 1000000n;
const BAND = 0.2; // SIM_DRIFT_MAX_BPS default 2000 → ±0.2 around 0.5

function pantaRow(over = {}) {
  return {
    marketId: 'panta-honesty-live-1',
    question: 'Will this imported market keep its live price when we bet it with fake money?',
    title: 'Honesty sample',
    category: 'Crypto',
    phase: 'primary',
    status: 'primary',
    yesPrice: '0.62',
    noPrice: '0.38',
    volumeUsdc: '1234.5',
    ...over,
  };
}

function fakeClient(items) {
  return { listMarkets: async () => ({ items, nextCursor: null }), getMarket: async () => ({}) };
}

async function importOne(db, row) {
  await createPantaSync({ db, liveClient: fakeClient([row]), env: {}, enabled: true, now, warn: () => {} }).tick();
  const { rows } = await db.query(`select id from markets where panta_market_id=$1`, [row.marketId]);
  return rows[0].id;
}

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  const terms = await acceptTerms(fetchJson, v.json.token);
  if (terms.res.status !== 200) throw new Error('acceptTerms fixture failed: ' + JSON.stringify(terms.json));
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function buy(fetchJson, U, marketId, side, amount) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let r = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
    if (r.res.status !== 200) return r;
    const oid = r.json.orderId;
    r = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
    const sig = signObj(U.kp, r.json.signPayload);
    r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
    if (r.res.status !== 409 || r.json?.error?.code !== 'QUOTE_STALE') return r;
  }
  throw new Error('unreachable');
}

async function conserve(db) {
  const { rows } = await db.query(`
    select
      coalesce((select sum(sim_usdc * ${MICRO}) from balances), 0)::bigint::text as bal,
      coalesce((select sum(amount * ${MICRO}) from mint_events), 0)::bigint::text as mint,
      coalesce((select sum(amount * ${MICRO}) from fee_events), 0)::bigint::text as createfee,
      coalesce((select sum(amount * ${MICRO}) from trades where kind='buy'), 0)::bigint::text as buys,
      coalesce((select sum(amount * ${MICRO}) from trades where kind='claim'), 0)::bigint::text as claims,
      coalesce((select sum(amount * ${MICRO}) from trades where kind='creator_fee_claim'), 0)::bigint::text as cclaims
  `);
  const r = rows[0];
  const houseEquity = BigInt(r.createfee) + BigInt(r.buys) - BigInt(r.claims) - BigInt(r.cclaims);
  return BigInt(r.bal) + houseEquity === BigInt(r.mint);
}

describe('panta honesty — price provenance under our bets', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('a bet does NOT move a live Panta price (poller owns it) and stays panta_live', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await auth(fetchJson, genWallet());
    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    const mid = await importOne(db, pantaRow());

    const res = await buy(fetchJson, U, mid, 'yes', 20);
    assert.equal(res.res.status, 200, JSON.stringify(res.json));

    const { rows } = await db.query('select yes_price, no_price, price_source, q_yes, volume from markets where id=$1', [mid]);
    const m = rows[0];
    assert.equal(Number(m.yes_price), 0.62, 'displayed price kept at the Panta quote');
    assert.equal(m.price_source, 'panta_live', 'still a live Panta quote, not relabeled');
    assert.ok(Number(m.q_yes) > 0, 'the ledger DID move (a real, bettable market)');
    assert.ok(Number(m.volume) > 0);
  });

  it('simulated drift on a Panta market stays inside the band and stays labeled simulated', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await auth(fetchJson, genWallet());
    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } }); // 200 headroom
    const mid = await importOne(db, pantaRow({ marketId: 'panta-honesty-sim-1' }));
    // No live quote available (poller down) → this market's price is ours to move, honestly.
    await db.query(`update markets set price_source='simulated', yes_price=0.5, no_price=0.5 where id=$1`, [mid]);

    await buy(fetchJson, U, mid, 'yes', 100); // a large play-money swing
    const { rows } = await db.query('select yes_price, price_source from markets where id=$1', [mid]);
    const m = rows[0];
    assert.equal(m.price_source, 'simulated', 'movement is honestly labeled simulated');
    assert.ok(Number(m.yes_price) <= 0.5 + BAND + 1e-9, `drift clamped to the band (got ${m.yes_price})`);
    assert.ok(Number(m.yes_price) >= 0.5 - BAND - 1e-9, `drift clamped to the band (got ${m.yes_price})`);
  });

  it('betting a Panta market conserves play money (same fake ledger)', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await auth(fetchJson, genWallet());
    await fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
    const mid = await importOne(db, pantaRow({ marketId: 'panta-honesty-cons-1' }));
    await buy(fetchJson, U, mid, 'no', 30);
    assert.ok(await conserve(db), 'Σbalances + houseEquity must equal Σminted after a Panta bet');
  });
});
