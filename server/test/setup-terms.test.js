import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeApp,
  makePrivyApp,
  setupTestEnv,
  teardownTestEnv,
  resetDb,
  acceptTerms,
} from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

// Account-setup + Terms consent. Hermetic (PGlite, injected Privy fake). These tests
// DELIBERATELY use a NON-terms `signIn()` (unlike the trade fixtures, which accept
// terms via acceptTerms) so they can prove the TERMS_REQUIRED gate actually blocks.

// Fresh wallet-auth account that has NOT accepted the Terms.
async function signIn(fetchJson, W) {
  const { json } = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, json.message);
  const v = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  assert.equal(v.res.status, 200);
  return { token: v.json.token, pub: W.pub, kp: W.kp, id: v.json.user.id };
}

// Market creation is NOT behind the terms gate (browse/author paths stay open), so a
// fresh creator can still seed a market for the buyer-side tests.
async function createMarket(fetchJson, UA, question) {
  let r = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ title: 'Setup Terms Room' }), headers: { Authorization: `Bearer ${UA.token}` } });
  const roomId = r.json.id;
  r = await fetchJson('/api/markets/quote', { method: 'POST', body: JSON.stringify({ roomId, question, resolutionRule: 'YES rule', sourcesOfTruth: ['https://x'] }), headers: { Authorization: `Bearer ${UA.token}` } });
  const q = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method: 'POST', body: JSON.stringify({ quoteId: q }), headers: { Authorization: `Bearer ${UA.token}` } });
  const sigM = signObj(UA.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method: 'POST', body: JSON.stringify({ quoteId: q, signature: sigM }), headers: { Authorization: `Bearer ${UA.token}` } });
  return r.json.id;
}

// quote -> build -> submit for one amount; returns the submit result (no retry: a
// single isolated buy in a fresh market does not race itself).
async function submitOrder(fetchJson, U, marketId, amount = 5) {
  const q = await fetchJson('/api/orders/quote', { method: 'POST', body: JSON.stringify({ marketId, side: 'yes', amount }), headers: { Authorization: `Bearer ${U.token}` } });
  if (q.res.status !== 200) return { stage: 'quote', r: q };
  const oid = q.json.orderId;
  const b = await fetchJson('/api/orders/build', { method: 'POST', body: JSON.stringify({ orderId: oid }), headers: { Authorization: `Bearer ${U.token}` } });
  if (b.res.status !== 200) return { stage: 'build', r: b };
  const sig = signObj(U.kp, b.json.signPayload);
  const r = await fetchJson('/api/orders/submit', { method: 'POST', body: JSON.stringify({ orderId: oid, signature: sig }), headers: { Authorization: `Bearer ${U.token}` } });
  return { stage: 'submit', r };
}

// Fake Privy verifier (same { did, solanaAddress } shape as the real seam): unknown
// token throws, exactly like the SDK on a bad token, so the route maps it to 401.
function fakeVerifier(map) {
  return async function verifyPrivyToken(token) {
    if (!(token in map)) throw new Error('invalid privy token');
    return map[token];
  };
}

const VALID_SETUP = {
  displayName: 'setup_user1',
  interests: ['trading', 'sports'],
  termsVersion: 'terms-draft-1',
  accepted: true,
};

function setupCall(fetchJson, token, body) {
  return fetchJson('/api/me/setup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/me/setup + TERMS_REQUIRED gate', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('a fresh account is BLOCKED from ordering before consent (403 TERMS_REQUIRED)', async () => {
    const { fetchJson, db } = await makeApp();
    const creator = await signIn(fetchJson, genWallet());
    const buyer = await signIn(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, creator, 'Gate blocks first?');

    // Quote + build are allowed (no money moves); only the committing submit is gated.
    const out = await submitOrder(fetchJson, buyer, marketId);
    assert.equal(out.stage, 'submit');
    assert.equal(out.r.res.status, 403);
    assert.equal(out.r.json.error.code, 'TERMS_REQUIRED');

    // Nothing was spent — the money path never ran.
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [buyer.id]);
    assert.equal(Number(rows[0].sim_usdc), 100);
  });

  it('the SAME account can order once setup completes (200 after consent)', async () => {
    const { fetchJson, db } = await makeApp();
    const creator = await signIn(fetchJson, genWallet());
    const buyer = await signIn(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, creator, 'Gate clears after consent?');

    const ok = await setupCall(fetchJson, buyer.token, VALID_SETUP);
    assert.equal(ok.res.status, 200);
    assert.equal(ok.json.user.setup_completed, true);

    const out = await submitOrder(fetchJson, buyer, marketId);
    assert.equal(out.r.res.status, 200, JSON.stringify(out.r.json));
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [buyer.id]);
    assert.equal(Number(rows[0].sim_usdc), 95);
  });

  it('setup writes ALL fields in one atomic shot and stores termsVersion', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await signIn(fetchJson, genWallet());
    const body = { ...VALID_SETUP, displayName: 'atomic_one', interests: ['streams'], termsVersion: 'terms-v9' };
    const r = await setupCall(fetchJson, U.token, body);
    assert.equal(r.res.status, 200);
    assert.equal(r.json.user.display_name, 'atomic_one');
    assert.deepEqual(r.json.user.interests, ['streams']);

    const { rows } = await db.query('select display_name, interests, terms_version, terms_accepted_at, setup_completed_at from users where id=$1', [U.id]);
    assert.equal(rows[0].display_name, 'atomic_one');
    assert.equal(rows[0].terms_version, 'terms-v9');
    assert.ok(rows[0].terms_accepted_at, 'terms_accepted_at set');
    assert.ok(rows[0].setup_completed_at, 'setup_completed_at set');
  });

  it('a bad payload writes NOTHING (atomicity on reject)', async () => {
    const { fetchJson, db } = await makeApp();
    const U = await signIn(fetchJson, genWallet());
    const { rows: before } = await db.query('select display_name, terms_version, terms_accepted_at, setup_completed_at from users where id=$1', [U.id]);
    assert.equal(before[0].terms_accepted_at, null);

    // accepted must be literal true.
    const bad = await setupCall(fetchJson, U.token, { ...VALID_SETUP, accepted: false });
    assert.equal(bad.res.status, 400);

    const { rows: after } = await db.query('select display_name, terms_version, terms_accepted_at, setup_completed_at from users where id=$1', [U.id]);
    assert.equal(after[0].display_name, before[0].display_name, 'display_name untouched');
    assert.equal(after[0].terms_accepted_at, null, 'no terms written on rejection');
    assert.equal(after[0].terms_version, null, 'no termsVersion written on rejection');
    assert.equal(after[0].setup_completed_at, null, 'setup not marked complete');
  });

  it('validation: interests/d_name/termsVersion/accepted all rejected with 400', async () => {
    const { fetchJson } = await makeApp();
    const U = await signIn(fetchJson, genWallet());
    const badBodies = [
      { ...VALID_SETUP, interests: ['trading', 'trading'] }, // duplicate
      { ...VALID_SETUP, interests: ['trading', 'sports', 'streams', 'crypto'] }, // >3 + unknown
      { ...VALID_SETUP, interests: ['crypto'] }, // outside vocabulary
      { ...VALID_SETUP, displayName: 'a' }, // too short
      { ...VALID_SETUP, displayName: '_leading' }, // bad leading char
      { ...VALID_SETUP, displayName: 'x'.repeat(21) }, // too long
      { ...VALID_SETUP, termsVersion: '' }, // empty
      { ...VALID_SETUP, termsVersion: 'v'.repeat(41) }, // > 40
      { displayName: 'GoodName', interests: [], termsVersion: 'v1' }, // accepted missing
      { ...VALID_SETUP, accepted: 'yes' }, // not literal true
    ];
    for (const body of badBodies) {
      const r = await setupCall(fetchJson, U.token, body);
      assert.equal(r.res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
    // 0 interests is legitimate (the plan marks the interests step skippable).
    const okEmpty = await setupCall(fetchJson, U.token, { ...VALID_SETUP, interests: [] });
    assert.equal(okEmpty.res.status, 200);
  });

  it('setup requires auth (401 with no token)', async () => {
    const { fetchJson } = await makeApp();
    const r = await fetchJson('/api/me/setup', { method: 'POST', body: JSON.stringify(VALID_SETUP) });
    assert.equal(r.res.status, 401);
  });

  it('/api/auth/me echoes setup_completed (false -> true)', async () => {
    const { fetchJson } = await makeApp();
    const U = await signIn(fetchJson, genWallet());
    const before = await fetchJson('/api/auth/me', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(before.res.status, 200);
    assert.equal(before.json.user.setup_completed, false);

    await setupCall(fetchJson, U.token, VALID_SETUP);
    const after = await fetchJson('/api/auth/me', { headers: { Authorization: `Bearer ${U.token}` } });
    assert.equal(after.json.user.setup_completed, true);
  });

  it('the privy session response echoes setup_completed (publicUser flows through)', async () => {
    const wallet = genWallet().pub;
    const p = await makePrivyApp(fakeVerifier({ 'tok-setup': { did: 'did-setup', solanaAddress: wallet } }));
    try {
      const r = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'tok-setup' }) });
      assert.equal(r.res.status, 200);
      // Brand-new Privy account has not completed setup — the field is present + false.
      assert.equal(Object.prototype.hasOwnProperty.call(r.json.user, 'setup_completed'), true);
      assert.equal(r.json.user.setup_completed, false);

      // Completing setup flips it on the very next /me for the same token.
      const s = await setupCall(p.fetchJson, r.json.token, VALID_SETUP);
      assert.equal(s.res.status, 200);
      const me = await p.fetchJson('/api/auth/me', { headers: { Authorization: `Bearer ${r.json.token}` } });
      assert.equal(me.json.user.setup_completed, true);
    } finally {
      await p.close();
    }
  });

  it('acceptTerms helper itself satisfies the gate (used by the trade fixtures)', async () => {
    const { fetchJson } = await makeApp();
    const creator = await signIn(fetchJson, genWallet());
    const W = genWallet();
    const buyer = await signIn(fetchJson, W);
    const marketId = await createMarket(fetchJson, creator, 'Helper unlocks ordering?');

    const st = await acceptTerms(fetchJson, buyer.token);
    assert.equal(st.res.status, 200);

    const out = await submitOrder(fetchJson, buyer, marketId);
    assert.equal(out.r.res.status, 200, JSON.stringify(out.r.json));
  });
});

describe('TERMS_REQUIRED gate on claims', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('a fresh account is BLOCKED from claiming (403 TERMS_REQUIRED)', async () => {
    const { fetchJson } = await makeApp();
    const creator = await signIn(fetchJson, genWallet());
    const buyer = await signIn(fetchJson, genWallet());
    const marketId = await createMarket(fetchJson, creator, 'Claim gate?');

    // Build a claim payload (not gated) then hit the money-moving /win route.
    const b = await fetchJson('/api/claims/win/build', { method: 'POST', body: JSON.stringify({ marketId }), headers: { Authorization: `Bearer ${buyer.token}` } });
    const sig = signObj(buyer.kp, b.json.signPayload);
    const r = await fetchJson('/api/claims/win', { method: 'POST', body: JSON.stringify({ marketId, signature: sig }), headers: { Authorization: `Bearer ${buyer.token}` } });
    assert.equal(r.res.status, 403);
    assert.equal(r.json.error.code, 'TERMS_REQUIRED');
  });
});
