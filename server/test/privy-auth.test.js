import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makePrivyApp, setupTestEnv, teardownTestEnv, resetDb } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

// Hermetic Privy + profile tests. NO live network: the Privy verifier is INJECTED as
// a fake (same { did, solanaAddress } shape as createPrivyVerifier) via makePrivyApp.
// The main app (makeApp) has no creds, so its /api/auth/privy/session honestly 503s —
// that degrade path is asserted too. /api/me/profile runs on the main app (auth only).

// A fake verifier backed by an explicit token → result map. Unknown token → throws,
// exactly like the real SDK on a bad/expired token (the route maps that to 401).
function fakeVerifier(map) {
  return async function verifyPrivyToken(token) {
    if (!(token in map)) throw new Error('invalid privy token');
    return map[token];
  };
}

// Create a real guest account through the untouched wallet path and return { token, wallet }.
async function makeGuest(fetchJson) {
  const W = genWallet();
  let r = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  assert.equal(r.res.status, 200);
  const sig = sign(W.kp, r.json.message);
  r = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  assert.equal(r.res.status, 200);
  return { token: r.json.token, wallet: W.pub, user: r.json.user };
}

describe('privy session auth', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('POST /auth/privy/session is honest 503 when Privy is not configured', async () => {
    const { fetchJson } = await makeApp();
    const r = await fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'x' }) });
    assert.equal(r.res.status, 503);
    assert.equal(r.json.error.code, 'PRIVY_DISABLED');
  });

  it('path (c): brand-new did + embedded wallet → creates user, just_created true', async () => {
    const wallet = genWallet().pub;
    const p = await makePrivyApp(fakeVerifier({ 'tok-new': { did: 'did-new', solanaAddress: wallet } }));
    try {
      const r = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'tok-new' }) });
      assert.equal(r.res.status, 200);
      assert.ok(r.json.token);
      assert.equal(r.json.user.wallet, wallet);
      assert.equal(r.json.user.privy_linked, true);
      assert.equal(r.json.user.just_created, true);
      assert.deepEqual(r.json.user.interests, []);

      // Welcome mint + balance were journalled for the new account (ledger invariant).
      const { rows: bal } = await p.db.query('select sim_usdc from balances where user_id=$1', [r.json.user.id]);
      assert.equal(Number(bal[0].sim_usdc), 100);
      const { rows: mints } = await p.db.query(`select count(*)::int c from mint_events where user_id=$1 and kind='welcome'`, [r.json.user.id]);
      assert.equal(mints[0].c, 1);

      // The returned token hydrates /api/auth/me with the new fields.
      const me = await p.fetchJson('/api/auth/me', { headers: { Authorization: `Bearer ${r.json.token}` } });
      assert.equal(me.res.status, 200);
      assert.equal(me.json.user.privy_linked, true);
      assert.deepEqual(me.json.user.interests, []);
    } finally {
      await p.close();
    }
  });

  it('path (c): 401 when the Privy account has no embedded Solana wallet', async () => {
    const p = await makePrivyApp(fakeVerifier({ 'tok-nowallet': { did: 'did-nowallet' } }));
    try {
      const r = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'tok-nowallet' }) });
      assert.equal(r.res.status, 401);
      assert.equal(r.json.error.code, 'UNAUTHORIZED');
    } finally {
      await p.close();
    }
  });

  it('401 on an invalid/expired token (verifier throws)', async () => {
    const p = await makePrivyApp(fakeVerifier({}));
    try {
      const r = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'garbage' }) });
      assert.equal(r.res.status, 401);
    } finally {
      await p.close();
    }
  });

  it('400 on a missing privyToken (validation)', async () => {
    const p = await makePrivyApp(fakeVerifier({}));
    try {
      const r = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({}) });
      assert.equal(r.res.status, 400);
    } finally {
      await p.close();
    }
  });

  it('path (a): a known did signs in WITHOUT re-creating (just_created false)', async () => {
    const wallet = genWallet().pub;
    const p = await makePrivyApp(fakeVerifier({ 'tok-a': { did: 'did-a', solanaAddress: wallet } }));
    try {
      const first = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'tok-a' }) });
      assert.equal(first.json.user.just_created, true);
      const second = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'tok-a' }) });
      assert.equal(second.res.status, 200);
      assert.equal(second.json.user.just_created, false);
      assert.equal(second.json.user.id, first.json.user.id);
      // Exactly one welcome mint for the account even after two sessions.
      const { rows } = await p.db.query(`select count(*)::int c from mint_events where kind='welcome'`);
      assert.equal(rows[0].c, 1);
    } finally {
      await p.close();
    }
  });

  it('path (b): guest upgrade attaches the did and keeps balance + pins', async () => {
    const main = await makeApp();
    const guest = await makeGuest(main.fetchJson);

    // Guest pins a stream (real data) and has its $100 welcome balance.
    const pin = await main.fetchJson('/api/pins', {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({ streamId: 'yt:abc123', source: 'youtube', title: 'Live Match', payload: { provider: 'youtube' } }),
    });
    assert.equal(pin.res.status, 201);

    const embeddedWallet = genWallet().pub;
    const p = await makePrivyApp(
      fakeVerifier({ 'tok-guest': { did: 'did-guest', solanaAddress: embeddedWallet } }),
    );
    try {
      const r = await p.fetchJson('/api/auth/privy/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${guest.token}` },
        body: JSON.stringify({ privyToken: 'tok-guest' }),
      });
      assert.equal(r.res.status, 200);
      assert.equal(r.json.user.id, guest.user.id, 'same account upgraded in place');
      assert.equal(r.json.user.wallet, guest.wallet, 'original signing wallet is preserved');
      assert.equal(r.json.user.privy_linked, true);
      assert.equal(r.json.user.just_created, false);

      // Balance AND live_pins rows survive the upgrade.
      const { rows: bal } = await p.db.query('select sim_usdc from balances where user_id=$1', [guest.user.id]);
      assert.equal(Number(bal[0].sim_usdc), 100);
      const pins = await p.fetchJson('/api/pins', { headers: { Authorization: `Bearer ${r.json.token}` } });
      assert.equal(pins.res.status, 200);
      assert.equal(pins.json.items.length, 1);
      assert.equal(pins.json.items[0].stream_id, 'yt:abc123');
    } finally {
      await p.close();
    }
  });

  it('duplicate privy_did across two users is rejected by the DB constraint', async () => {
    const wallet = genWallet().pub;
    const p = await makePrivyApp(fakeVerifier({ 'tok-dup': { did: 'did-dup', solanaAddress: wallet } }));
    try {
      const first = await p.fetchJson('/api/auth/privy/session', { method: 'POST', body: JSON.stringify({ privyToken: 'tok-dup' }) });
      assert.equal(first.res.status, 200);
      // Force a second row with the same DID — must hit the unique constraint.
      await assert.rejects(
        p.db.query('insert into users(wallet, privy_did) values($1,$2)', [genWallet().pub, 'did-dup']),
        /duplicate key|Unique|violates/i,
      );
    } finally {
      await p.close();
    }
  });
});

describe('user profile (PUT /api/me/profile)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('writes display name + interests and echoes them on /me', async () => {
    const { fetchJson } = await makeApp();
    const guest = await makeGuest(fetchJson);
    const r = await fetchJson('/api/me/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({ displayName: 'Edge_1', interests: ['trading', 'sports'] }),
    });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.user.display_name, 'Edge_1');
    assert.deepEqual(r.json.user.interests, ['trading', 'sports']);

    const me = await fetchJson('/api/auth/me', { headers: { Authorization: `Bearer ${guest.token}` } });
    assert.deepEqual(me.json.user.interests, ['trading', 'sports']);
  });

  it('rejects an invalid display name (bad chars, too short, leading punctuation)', async () => {
    const { fetchJson } = await makeApp();
    const guest = await makeGuest(fetchJson);
    for (const displayName of ['bad name!', 'a', '_leading', 'trailing-']) {
      const r = await fetchJson('/api/me/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${guest.token}` },
        body: JSON.stringify({ displayName, interests: [] }),
      });
      assert.equal(r.res.status, 400, `expected 400 for displayName=${JSON.stringify(displayName)}`);
    }
  });

  it('rejects more than 3 interests and duplicate/unknown interest values', async () => {
    const { fetchJson } = await makeApp();
    const guest = await makeGuest(fetchJson);
    const bad = [
      ['trading', 'sports', 'streams', 'trading'], // 4 values + dup
      ['trading', 'trading'], // duplicate
      ['crypto'], // outside the closed vocabulary
    ];
    for (const interests of bad) {
      const r = await fetchJson('/api/me/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${guest.token}` },
        body: JSON.stringify({ displayName: 'GoodName', interests }),
      });
      assert.equal(r.res.status, 400, `expected 400 for interests=${JSON.stringify(interests)}`);
    }
    // 3 unique values is valid.
    const ok = await fetchJson('/api/me/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({ displayName: 'GoodName', interests: ['trading', 'sports', 'streams'] }),
    });
    assert.equal(ok.res.status, 200);
  });

  it('profile route requires auth', async () => {
    const { fetchJson } = await makeApp();
    const r = await fetchJson('/api/me/profile', { method: 'PUT', body: JSON.stringify({ displayName: 'NoAuth', interests: [] }) });
    assert.equal(r.res.status, 401);
  });
});
