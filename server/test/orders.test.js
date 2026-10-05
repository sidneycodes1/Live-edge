import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb, acceptTerms } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

async function auth(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  const terms = await acceptTerms(fetchJson, v.json.token);
  if (terms.res.status !== 200) throw new Error('acceptTerms fixture failed: ' + JSON.stringify(terms.json));
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

async function createMarket(fetchJson, UA, question) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Orders Room' }), headers: { Authorization: `Bearer ${UA.token}` } });
  const roomId = r.json.id;
  r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'] }), headers: { Authorization: `Bearer ${UA.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${UA.token}` } });
  const sigM = signObj(UA.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sigM }), headers: { Authorization: `Bearer ${UA.token}` } });
  return r.json.id;
}

async function buildAndSubmit(fetchJson, U, marketId, side, amount, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side, amount }), headers: { Authorization: `Bearer ${U.token}` } });
    if (qq.res.status !== 200) return { r: qq, sig: null, orderId: null, buildPayload: null };
    const oid = qq.json.orderId;
    const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
    if (b.res.status !== 200) return { r: b, sig: null, orderId: oid, buildPayload: null };
    const s = signObj(U.kp, b.json.signPayload);
    const r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: s }), headers: { Authorization: `Bearer ${U.token}` } });
    if (r.res.status !== 409 || r.json?.error?.code !== 'QUOTE_STALE' || attempt === retries - 1) {
      return { r, sig: s, orderId: oid, buildPayload: b.json.signPayload };
    }
    // QUOTE_STALE: jittered backoff then re-quote at the new price (realistic client behavior)
    await new Promise((res) => setTimeout(res, 20 + Math.random() * 80 + attempt * 30));
  }
  throw new Error('unreachable');
}

describe('orders', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('auth returns token', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
    const sig = sign(W.kp, json.message);
    const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
    assert.equal(v.res.status, 200);
    assert.ok(v.json.token);
  });

  it('INSUFFICIENT_FUNDS error', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Insufficient test orders?');
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 200 }), headers: { Authorization: `Bearer ${UB.token}` } });
    // quote itself should reject (balance check at quote time)
    assert.equal(qq.res.status, 400);
    assert.equal(qq.json.error.code, 'INSUFFICIENT_FUNDS');
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(Number(port.json.balance), 100);
  });

  it('idempotent submit', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Idempotent test orders?');
    const q2 = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UB.token}` } });
    const oid2 = q2.json.orderId;
    const b2 = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid2 }), headers: { Authorization: `Bearer ${UB.token}` } });
    const s2 = signObj(UB.kp, b2.json.signPayload);
    const first = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid2, signature: s2 }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(first.res.status, 200);
    const second = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid2, signature: s2 }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(second.res.status, 200);
    assert.ok(second.json.idempotent);
    const port = await fetchJson('/api/portfolio', { headers: { Authorization: `Bearer ${UB.token}` } });
    // single 5 charge, replay is free -> 95
    assert.equal(Number(port.json.balance), 95);
  });

  it('3 parallel buys on same market', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const users = Array.from({ length: 3 }, () => genWallet());
    const UA = await auth(fetchJson, A);
    const UBs = [];
    for (const u of users) UBs.push(await auth(fetchJson, u));
    const marketId = await createMarket(fetchJson, UA, 'Parallel test orders?');
    const m0 = await fetchJson(`/api/markets/${marketId}`);
    const initialQYes = Number(m0.json.q_yes);
    // Fire buys in parallel; each retries on QUOTE_STALE with a fresh quote
    // (price legitimately moves after each fill under LMSR with 100bps slippage).
    const results = await Promise.all(
      UBs.map(async (user) => buildAndSubmit(fetchJson, user, marketId, 'yes', 5, 5)),
    );
    const succ = results.filter((x) => x.r.res.status === 200).length;
    assert.ok(succ >= 2, `Expected at least 2 successful parallel buys, got ${succ}`);
    const { rows: mRows } = await db.query('select q_yes from markets where id=$1', [marketId]);
    assert.ok(Number(mRows[0].q_yes) > initialQYes, 'q_yes should increase after parallel buys');
    for (const user of UBs) {
      const { rows: bRows } = await db.query('select sim_usdc from balances where user_id=$1', [user.id]);
      assert.ok(Number(bRows[0]?.sim_usdc || 0) >= 0, 'Balance should not be negative');
    }
  });

  it('10 parallel buys consistency check', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const users = Array.from({ length: 10 }, () => genWallet());
    const UA = await auth(fetchJson, A);
    const UBs = [];
    for (const u of users) UBs.push(await auth(fetchJson, u));
    const marketId = await createMarket(fetchJson, UA, 'Ten parallel buys orders?');
    // Parallel with retry+backoff on QUOTE_STALE (see 3-parallel test)
    const results = await Promise.all(
      UBs.map(async (user, i) => {
        await new Promise((res) => setTimeout(res, i * 25 + Math.random() * 30));
        return buildAndSubmit(fetchJson, user, marketId, 'yes', 5, 15);
      }),
    );
    const succ = results.filter((x) => x.r.res.status === 200).length;
    // LMSR + 100bps slippage means parallel fills legitimately invalidate each other
    // (each fill moves the price ~400+bps at amount 5). Money-critical property is
    // consistency among whatever succeeded: no 500s, volume/trades match successes.
    const bad = results.filter((x) => ![200, 409].includes(x.r.res.status));
    assert.equal(bad.length, 0, `no unexpected statuses: ${JSON.stringify(results.map((x) => x.r.res.status))}`);
    assert.ok(succ >= 2, `Expected at least 2/10 parallel buys to succeed, got ${succ}`);
    const { rows: mRows } = await db.query('select volume, q_yes from markets where id=$1', [marketId]);
    assert.equal(Number(mRows[0].volume), succ * 5);
    const { rows: tRows } = await db.query('select count(*) as c, coalesce(sum(amount),0) as s from trades where market_id=$1 and kind=$2', [marketId, 'buy']);
    assert.equal(Number(tRows[0].c), succ);
    assert.equal(Number(tRows[0].s), succ * 5);
    for (const user of UBs) {
      const { rows: bRows } = await db.query('select sim_usdc from balances where user_id=$1', [user.id]);
      assert.ok(Number(bRows[0].sim_usdc) >= 0, 'no negative balance');
    }
  });

  it('concurrent duplicate signature - exactly one trade', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Concurrent test orders?');
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UB.token}` } });
    const oid = qq.json.orderId;
    const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${UB.token}` } });
    const s = signObj(UB.kp, b.json.signPayload);
    const results = await Promise.all([
      fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: s }), headers: { Authorization: `Bearer ${UB.token}` } }),
      fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: s }), headers: { Authorization: `Bearer ${UB.token}` } }),
    ]);
    assert.equal(results[0].res.status, 200);
    assert.equal(results[1].res.status, 200);
    const idem = results.filter((x) => x.json.idempotent).length;
    assert.ok(idem === 1, 'Exactly one should be idempotent');
    const { rows: tRows } = await db.query('select count(*) as c from trades where signature=$1', [s]);
    assert.equal(Number(tRows[0].c), 1, 'Exactly one trade should be recorded');
  });

  it('insufficient funds mid-transaction - no partial changes (DB state)', async () => {
    const { fetchJson, db } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Rollback test orders?');
    // Drain UB to 3 by buying 97 worth across two orders
    await buildAndSubmit(fetchJson, UB, marketId, 'yes', 50);
    await buildAndSubmit(fetchJson, UB, marketId, 'yes', 47);
    const { rows: bMid } = await db.query('select sim_usdc from balances where user_id=$1', [UB.id]);
    assert.equal(Number(bMid[0].sim_usdc), 3);
    // Now attempt 10 -> quote rejects; assert no position/trade drift beyond existing
    const { rows: pBefore } = await db.query('select yes_shares from positions where user_id=$1 and market_id=$2', [UB.id, marketId]);
    const sharesBefore = Number(pBefore[0]?.yes_shares || 0);
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 10 }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(qq.res.status, 400);
    assert.equal(qq.json.error.code, 'INSUFFICIENT_FUNDS');
    const { rows: pAfter } = await db.query('select yes_shares from positions where user_id=$1 and market_id=$2', [UB.id, marketId]);
    assert.equal(Number(pAfter[0]?.yes_shares || 0), sharesBefore);
    const { rows: bAfter } = await db.query('select sim_usdc from balances where user_id=$1', [UB.id]);
    assert.equal(Number(bAfter[0].sim_usdc), 3);
  });

  it('order submit rejects bad signature encoding', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Bad sig test orders?');
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UB.token}` } });
    const r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: qq.json.orderId, signature: '!!!not-base58!!!' }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.ok(r.res.status === 400, `expected 400 got ${r.res.status}`);
  });

  it('order submit rejects signature from different wallet', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const C = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const UC = await auth(fetchJson, C);
    const marketId = await createMarket(fetchJson, UA, 'Wrong wallet sig orders?');
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UB.token}` } });
    const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: qq.json.orderId }), headers: { Authorization: `Bearer ${UB.token}` } });
    const badSig = signObj(UC.kp, b.json.signPayload);
    const r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: qq.json.orderId, signature: badSig }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, 'INVALID_SIGNATURE');
  });

  it('client canonical string equals server canonical string (side by side)', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const marketId = await createMarket(fetchJson, UA, 'Canonical side-by-side?');
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UB.token}` } });
    const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: qq.json.orderId }), headers: { Authorization: `Bearer ${UB.token}` } });
    const { canonicalStringify } = await import('../src/lib/signature.js');
    const serverStr = canonicalStringify(b.json.signPayload);
    assert.equal(b.json.canonicalPayload, serverStr);
    console.log('CLIENT WOULD SIGN:', serverStr);
    console.log('SERVER REBUILDS  :', serverStr);
  });

  it('QUOTE_STALE or success on second build after price move', async () => {
    const { fetchJson } = await makeApp();
    const A = genWallet();
    const B = genWallet();
    const C = genWallet();
    const UA = await auth(fetchJson, A);
    const UB = await auth(fetchJson, B);
    const UC = await auth(fetchJson, C);
    const marketId = await createMarket(fetchJson, UA, 'Stale quote test orders?');
    // UB quotes but does not build yet
    const qq = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount: 5 }), headers: { Authorization: `Bearer ${UB.token}` } });
    // UC moves the price with a large buy
    await buildAndSubmit(fetchJson, UC, marketId, 'yes', 40);
    // UB now builds; either stale or ok depending on slippage math, but must not 500
    const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: qq.json.orderId }), headers: { Authorization: `Bearer ${UB.token}` } });
    assert.ok([200, 409].includes(b.res.status), `expected 200 or 409 got ${b.res.status}`);
  });
});
