import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeApp, setupTestEnv, teardownTestEnv, resetDb } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

const PW = 'correct horse battery';

async function guestSignIn(fetchJson, W) {
  let r = await fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet: W.pub }) });
  const sig = sign(W.kp, r.json.message);
  r = await fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
  return r.json; // { token, user }
}

describe('email auth (F-004)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('register creates an email account with welcome balance', async () => {
    const { fetchJson, db } = await makeApp();
    const W = genWallet();
    const r = await fetchJson('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'Alice@Example.com', password: PW, wallet: W.pub }),
    });
    assert.equal(r.res.status, 201);
    assert.ok(r.json.token);
    assert.equal(r.json.user.kind, 'email');
    // stored normalized (lowercase) email; never returns password_hash
    assert.equal(r.json.user.email, 'alice@example.com');
    assert.equal(r.json.user.password_hash, undefined);
    const { rows } = await db.query('select sim_usdc from balances where user_id=$1', [r.json.user.id]);
    assert.equal(Number(rows[0].sim_usdc), 100);
  });

  it('rejects a duplicate email with a clear 409', async () => {
    const { fetchJson } = await makeApp();
    const W1 = genWallet();
    const W2 = genWallet();
    let r = await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'dup@x.com', password: PW, wallet: W1.pub }) });
    assert.equal(r.res.status, 201);
    r = await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'dup@x.com', password: PW, wallet: W2.pub }) });
    assert.equal(r.res.status, 409);
    assert.equal(r.json.error.code, 'EMAIL_EXISTS');
  });

  it('email uniqueness is case-insensitive', async () => {
    const { fetchJson } = await makeApp();
    const W1 = genWallet();
    const W2 = genWallet();
    let r = await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'Same@x.com', password: PW, wallet: W1.pub }) });
    assert.equal(r.res.status, 201);
    r = await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'same@X.com', password: PW, wallet: W2.pub }) });
    assert.equal(r.res.status, 409);
    assert.equal(r.json.error.code, 'EMAIL_EXISTS');
  });

  it('rejects a too-short password via validation (400)', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const r = await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'p@x.com', password: 'short', wallet: W.pub }) });
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
  });

  it('login succeeds with correct password, fails on wrong password and unknown email', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    await fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'login@x.com', password: PW, wallet: W.pub }) });

    let r = await fetchJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'login@x.com', password: PW }) });
    assert.equal(r.res.status, 200);
    assert.ok(r.json.token);
    assert.equal(r.json.user.kind, 'email');

    r = await fetchJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'login@x.com', password: 'wrong-password' }) });
    assert.equal(r.res.status, 401);
    assert.equal(r.json.error.code, 'INVALID_CREDENTIALS');

    r = await fetchJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'nobody@x.com', password: PW }) });
    assert.equal(r.res.status, 401);
    assert.equal(r.json.error.code, 'INVALID_CREDENTIALS');
  });

  it('GET /me requires auth', async () => {
    const { fetchJson } = await makeApp();
    let r = await fetchJson('/api/auth/me');
    assert.equal(r.res.status, 401);

    const W = genWallet();
    const { token } = await guestSignIn(fetchJson, W);
    r = await fetchJson('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.user.wallet, W.pub);
    assert.equal(r.json.user.kind, 'guest');
  });

  it('POST /logout returns ok for an authenticated caller', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const { token } = await guestSignIn(fetchJson, W);
    const r = await fetchJson('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.ok, true);
  });

  it('guest upgrade preserves id, balance and positions; flips kind and upgraded_at', async () => {
    const { fetchJson, db } = await makeApp();
    const W = genWallet();
    const { token, user } = await guestSignIn(fetchJson, W);
    // guest /verify response shape is intentionally unchanged (no `kind`),
    // so read kind from the DB row to confirm this starts as a guest.
    const { rows: preU } = await db.query('select kind from users where id=$1', [user.id]);
    assert.equal(preU[0].kind, 'guest');

    // give the guest a non-default balance and a position to prove they survive upgrade
    await db.query('update balances set sim_usdc=250 where user_id=$1', [user.id]);
    const mid = randomUUID();
    const now = new Date().toISOString();
    await db.query(
      `insert into markets(id, creator_id, source, question, resolution_rule, sources_of_truth, start_time, end_time, resolution_time, yes_price, no_price)
       values($1,$2,'sim',$3,'rule',$4,$5,$6,$7,0.5,0.5)`,
      [mid, user.id, 'Upgrade test market?', ['https://x.com'], now, now, now],
    );
    await db.query('insert into positions(user_id, market_id, yes_shares, no_shares) values($1,$2,10,0)', [user.id, mid]);

    const r = await fetchJson('/api/auth/upgrade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: 'upgrade@x.com', password: PW }),
    });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.user.id, user.id, 'id must not change');
    assert.equal(r.json.user.wallet, W.pub, 'wallet must not change');
    assert.equal(r.json.user.kind, 'email');

    const { rows: u } = await db.query('select * from users where id=$1', [user.id]);
    assert.ok(u[0].upgraded_at, 'upgraded_at must be set');
    assert.equal(u[0].email, 'upgrade@x.com');

    const { rows: b } = await db.query('select sim_usdc from balances where user_id=$1', [user.id]);
    assert.equal(Number(b[0].sim_usdc), 250, 'balance must be untouched');

    const { rows: p } = await db.query('select * from positions where user_id=$1', [user.id]);
    assert.equal(p.length, 1, 'position must be untouched');
    assert.equal(Number(p[0].yes_shares), 10);

    // and the account can now log in by email/password, landing on the SAME id
    const l = await fetchJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'upgrade@x.com', password: PW }) });
    assert.equal(l.res.status, 200);
    assert.equal(l.json.user.id, user.id);
  });

  it('cannot upgrade an account that already has an email', async () => {
    const { fetchJson } = await makeApp();
    const W = genWallet();
    const { token } = await guestSignIn(fetchJson, W);
    let r = await fetchJson('/api/auth/upgrade', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: 'a@x.com', password: PW }) });
    assert.equal(r.res.status, 200);
    r = await fetchJson('/api/auth/upgrade', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: 'b@x.com', password: PW }) });
    assert.equal(r.res.status, 409);
    assert.equal(r.json.error.code, 'ALREADY_UPGRADED');
  });
});
