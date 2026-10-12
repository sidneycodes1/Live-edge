import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb, acceptTerms } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

// F-009 / Phase 4.1 money-conservation invariant.
//
// Every sim_usdc token movement is journaled: welcome + faucet mints (mint_events),
// buys / win-claims / creator-fee-claims (trades), and creation fees (fee_events).
// Therefore the tokens must reconcile exactly:
//
//     Σ balances  +  houseEquity  ==  Σ minted
//   where houseEquity = buys + creationFees − claims − creatorClaims
//
// (houseEquity is the cash the house/AMM still holds: everything spent into the
// system that has not been paid back out). We sum in INTEGER MICRO-UNITS (×1e6,
// bigint) so the check itself has zero float error, and assert houseEquity ≥ 0 so
// the operator can never be silently insolvent.

const MICRO = 1000000n;

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  const terms = await acceptTerms(fetchJson, v.json.token);
  if (terms.res.status !== 200) throw new Error('acceptTerms fixture failed: ' + JSON.stringify(terms.json));
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
async function claim(fetchJson, U, marketId, kind) {
  const path = kind === 'creator' ? '/api/claims/creator-fees' : '/api/claims/win';
  let r = await fetchJson(`${path}/build`, { method: 'POST', body: JSON.stringify({ marketId }), headers: { Authorization: `Bearer ${U.token}` } });
  const sig = signObj(U.kp, r.json.signPayload);
  return fetchJson(path, { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
}
async function faucet(fetchJson, U) {
  return fetchJson('/api/faucet', { method: 'POST', headers: { Authorization: `Bearer ${U.token}` } });
}

// Sum every journaled movement in integer micro-units, straight from the DB so the
// harness itself introduces no floating-point error.
async function micro(db) {
  const { rows } = await db.query(`
    select
      coalesce((select sum(sim_usdc * ${MICRO}) from balances), 0)::bigint::text as bal,
      coalesce((select sum(amount * ${MICRO}) from mint_events), 0)::bigint::text as mint,
      coalesce((select sum(amount * ${MICRO}) from fee_events), 0)::bigint::text as createfee,
      coalesce((select sum(amount * ${MICRO}) from trades where kind='buy'), 0)::bigint::text as buys,
      coalesce((select sum(amount * ${MICRO}) from trades where kind='claim'), 0)::bigint::text as claims,
      coalesce((select sum(amount * ${MICRO}) from trades where kind='creator_fee_claim'), 0)::bigint::text as cclaims,
      coalesce((select min(sim_usdc * ${MICRO}) from balances), 0)::bigint::text as minbal,
      coalesce((select count(distinct market_id) from trades where kind='buy'), 0)::bigint::text as active_markets
  `);
  const r = rows[0];
  // Prior-aware virtual-liquidity bound. A UNIFORM (prior 0.5) market can only ever
  // push the house to -B*ln(2). A prior-weighted LMSR market opens at price = prior,
  // so its worst-case directional loss is B*ln(1/min(pi_yes,pi_no)) — strictly larger
  // than B*ln(2) for any confident line. This sums that per-MARKET bound across every
  // market that has real buys, so a non-0.5 prior never lets the check understate the
  // true (still finite) AMM exposure. For an all-0.5 fixture this equals
  // activeMarkets * B*ln(2) exactly — the existing uniform markets are unaffected.
  const { rows: priorRows } = await db.query(
    `select distinct t.market_id, m.prior_yes from trades t join markets m on m.id = t.market_id where t.kind='buy'`,
  );
  let virtualMicro = 0;
  for (const pr of priorRows) {
    const p = Number(pr.prior_yes);
    const pmin = Math.min(p, 1 - p);
    virtualMicro += B * Math.log(1 / pmin) * 1e6;
  }
  return {
    bal: BigInt(r.bal),
    mint: BigInt(r.mint),
    createfee: BigInt(r.createfee),
    buys: BigInt(r.buys),
    claims: BigInt(r.claims),
    cclaims: BigInt(r.cclaims),
    minbal: BigInt(r.minbal),
    activeMarkets: BigInt(r.active_markets),
    virtualBound: BigInt(Math.floor(virtualMicro)),
  };
}

// The simulator opens every market at price 0.5 with q_yes=q_no=0, i.e. the LMSR
// operator implicitly advances the AMM's virtual liquidity cost(0,0)=B*ln(2) per
// market. That is the ONLY place play money can be created beyond the mints, so it
// is a hard, principled bound on how negative "house equity" may ever go.
const B = 50; // SIM_LIQUIDITY_B used by the test env
const VIRTUAL_PER_MARKET = BigInt(Math.floor(B * Math.LN2 * 1e6)); // micro-units

describe('money conservation invariant (F-009 / Phase 4.1)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('reconciles balances + house equity to total minted across the FULL lifecycle', async () => {
    const { fetchJson, db } = await makeApp();
    const A = await auth(fetchJson, genWallet()); // creator
    const B = await auth(fetchJson, genWallet()); // trader
    const C = await auth(fetchJson, genWallet()); // second trader

    await faucet(fetchJson, B); // B: 100 -> 200 (headroom for a graduation-sized buy)

    const roomId = await createRoom(fetchJson, A, 'Invariant Room');
    const mid = await createMarket(fetchJson, A, roomId, 'Invariant lifecycle market?'); // A: fee deducted

    await buy(fetchJson, B, mid, 'yes', 100); // pushes volume to 100 -> graduates
    await buy(fetchJson, C, mid, 'yes', 5);

    // Resolve YES so both YES holders can redeem and the creator can claim fees.
    await fetchJson(`/api/markets/${mid}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'yes', force: true }), headers: { Authorization: `Bearer ${A.token}` } });

    const win = await claim(fetchJson, B, mid, 'win');
    assert.equal(win.res.status, 200, JSON.stringify(win.json));
    await claim(fetchJson, C, mid, 'win');
    // Market graduated (volume >= 100) + resolved -> creator fee claim allowed.
    const fees = await claim(fetchJson, A, mid, 'creator');
    assert.equal(fees.res.status, 200, JSON.stringify(fees.json));

    const m = await micro(db);
    const houseEquity = m.createfee + m.buys - m.claims - m.cclaims;
    // (1) Core conservation of the LEDGER, exact in micro-units: a user's balance can
    // only change via a journaled event, so balances reconcile perfectly to the mints
    // and spends. This is the money-integrity guardrail (F-009 / F-006).
    assert.equal(m.bal + houseEquity, m.mint, `Σbalances(${m.bal}) + houseEquity(${houseEquity}) must equal minted(${m.mint})`);
    // (2) No user balance may go negative.
    assert.ok(m.minbal >= 0n, 'no user balance may go negative');
    // (3) Money can only be created up to the LMSR AMM's virtual liquidity (B*ln2 per
    // active market). This is a real, principled cap, NOT a fudge: houseEquity can be
    // negative because the sim does not pre-fund the 0.5 opening price, but the AMM
    // structure mathematically bounds how much. If this ever exceeds the bound, the
    // AMM is over-paying and money is being minted from nothing.
    const bound = m.activeMarkets * VIRTUAL_PER_MARKET;
    assert.ok(houseEquity >= -bound, `houseEquity ${houseEquity} below virtual-liquidity bound -${bound} (money minted beyond the AMM)`);
  });

  it('stays balanced with only mints (no trades, fees, or claims yet)', async () => {
    const { fetchJson, db } = await makeApp();
    const A = await auth(fetchJson, genWallet());
    await faucet(fetchJson, A);
    const m = await micro(db);
    const houseEquity = m.createfee + m.buys - m.claims - m.cclaims;
    assert.equal(houseEquity, 0n, 'no trades => house holds nothing beyond burned fees');
    assert.equal(m.bal, m.mint, 'with no spends, balances equal total minted');
    assert.equal(m.mint / MICRO, 200n, 'welcome (100) + faucet (100)');
  });

  // Gemini opening line (prior_yes) must NOT mint play money. Open a market at a
  // confident 0.9 line, load the CHEAP side (NO @ ~0.1), resolve it NO, and redeem —
  // the worst-case directional case for the AMM. The ledger must still reconcile
  // EXACTLY, and the house loss must stay inside the honest prior-aware bound
  // B*ln(1/0.1)=B*ln(10) (which is why a flat B*ln(2) bound would be wrong here).
  it('a prior (opening line) conserves money exactly and stays inside its widened bound', async () => {
    const { fetchJson, db } = await makeApp();
    const A = await auth(fetchJson, genWallet()); // creator
    const C = await auth(fetchJson, genWallet()); // buys the cheap NO side

    const roomId = await createRoom(fetchJson, A, 'Prior Room');
    const mid = await createMarket(fetchJson, A, roomId, 'Does this prior market conserve money?');
    // Stamp a confident Gemini line exactly as the engine insert would.
    await db.query(`update markets set prior_yes=0.9 where id=$1`, [mid]);

    await buy(fetchJson, C, mid, 'no', 50); // loads the ~0.1 side
    await fetchJson(`/api/markets/${mid}/resolve`, {
      method: 'POST', body: JSON.stringify({ outcome: 'no', force: true }),
      headers: { Authorization: `Bearer ${A.token}` },
    });
    const win = await claim(fetchJson, C, mid, 'win');
    assert.equal(win.res.status, 200, JSON.stringify(win.json));

    const m = await micro(db);
    const houseEquity = m.createfee + m.buys - m.claims - m.cclaims;
    // (1) THE money-integrity guardrail: exact to the micro-unit, independent of price model.
    assert.equal(m.bal + houseEquity, m.mint, `Σbalances(${m.bal}) + houseEquity(${houseEquity}) must equal minted(${m.mint})`);
    assert.ok(m.minbal >= 0n, 'no user balance may go negative');
    // (2) The prior WIDENS the house's exposure beyond B*ln(2), but only up to the
    // honest per-market bound. Prove the generalized bound is what we rely on now.
    const flatBound = m.activeMarkets * VIRTUAL_PER_MARKET;
    assert.ok(m.virtualBound > flatBound, 'a 0.9 line must widen the bound beyond B*ln(2) (documents the prior-aware change)');
    assert.ok(houseEquity >= -m.virtualBound, `houseEquity ${houseEquity} below prior-aware bound -${m.virtualBound} (money minted beyond the AMM)`);
  });
});
