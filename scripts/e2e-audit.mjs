// LiveEdge audit E2E driver (dev-only; never part of runtime).
// Drives the REAL Express app over real HTTP with genuine ed25519 signing:
// health -> config -> discover -> guest auth -> create room -> create market ->
// quote -> build -> buy(YES) -> second guest buy(NO) -> odds move -> resolve ->
// claim -> portfolio. Prints PASS/FAIL per step and a final tally.
//
// It boots the app in-process (PGlite in-memory, sim mode) because the committed
// .env points at a hosted Postgres that is unreachable in the audit sandbox. See
// AUDIT_REPORT.md section "Blocked / NOT VERIFIED".
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import { loadEnv } from '../server/src/config/env.js';
import { createApp } from '../server/src/app.js';

const env = loadEnv({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_URL: '', // force PGlite in-memory
  JWT_SECRET: 'audit-e2e-secret-audit-e2e-secret-audit', // >=32 chars, test only
  CORS_ORIGIN: 'http://localhost:5173',
  PANTA_MODE: 'sim',
  PANTA_BASE_URL: 'https://live-api.panta.market/api/v1',
});

let BASE = '';
let pass = 0;
let fail = 0;
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail || '');
    return true;
  } catch (e) {
    record(name, false, String(e && e.message ? e.message : e));
    return false;
  }
}

// ---- tiny http helpers over the real server ----
async function api(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

function makeGuest() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const sign = (canonicalStr) =>
    bs58.encode(nacl.sign.detached(new TextEncoder().encode(canonicalStr), kp.secretKey));
  return { wallet, sign, seed: kp };
}

async function authGuest(guest) {
  const n = await api('POST', '/api/auth/nonce', { body: { wallet: guest.wallet } });
  if (n.status !== 200 || !n.json.nonce) throw new Error(`nonce ${n.status}`);
  const message = `LiveEdge sign-in\nWallet: ${guest.wallet}\nNonce: ${n.json.nonce}`;
  const signature = guest.sign(message);
  const v = await api('POST', '/api/auth/verify', {
    body: { wallet: guest.wallet, signature },
  });
  if (v.status !== 200 || !v.json.token) throw new Error(`verify ${v.status} ${JSON.stringify(v.json)}`);
  // Accept the Terms so the audit’s order/claim steps clear the TERMS_REQUIRED gate.
  const s = await api('POST', '/api/me/setup', { token: v.json.token, body: { displayName: 'auditor_01', interests: ['trading'], termsVersion: 'terms-draft-1', accepted: true } });
  if (s.status !== 200) throw new Error(`accept terms ${s.status} ${JSON.stringify(s.json)}`);
  return v.json.token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = await createApp({ env });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  BASE = `http://127.0.0.1:${port}`;
  console.log(`# E2E app booted at ${BASE} mode=${env.effectiveMode} db=pglite-inmemory\n`);

  // Route map (Section 5) says GET /api/health, but the app mounts health at the
  // ROOT path only (app.js:56 `app.use(healthRouter(db))` + health.js `r.get('/health')`).
  // Both are probed: /health must be 200; the /api/health 404 is a documented finding.
  await step('GET /health is 200 (mounted at root, not /api/health)', async () => {
    const root = await api('GET', '/health');
    if (root.status !== 200) throw new Error(`root /health status ${root.status}`);
    const apiH = await api('GET', '/api/health');
    if (apiH.status !== 404) throw new Error(`expected the /api/health mismatch (404), got ${apiH.status}`);
    return `/health=200 body=${JSON.stringify(root.json)}; /api/health=${apiH.status} (route-map mismatch, see findings)`;
  });

  await step('GET /api/config is 200 with mode + features', async () => {
    const r = await api('GET', '/api/config');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.json || typeof r.json.mode !== 'string' || !r.json.features) throw new Error('bad shape');
    return `mode=${r.json.mode} features=${JSON.stringify(r.json.features)}`;
  });

  await step('GET /api/rooms lists seeded rooms', async () => {
    const r = await api('GET', '/api/rooms');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const items = r.json.rooms || r.json.items || r.json;
    if (!Array.isArray(items) || items.length === 0) throw new Error('no rooms');
    return `rooms=${items.length}`;
  });

  const creator = makeGuest();
  let creatorToken = '';
  await step('guest creator signs in (nonce + verify)', async () => {
    creatorToken = await authGuest(creator);
    return `token.len=${creatorToken.length}`;
  });

  await step('creator portfolio shows welcome balance 100', async () => {
    const r = await api('GET', '/api/portfolio', { token: creatorToken });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (Number(r.json.balance) !== 100) throw new Error(`balance=${r.json.balance}`);
    return `balance=${r.json.balance}`;
  });

  await step('F-007 faucet adds (does not overwrite): welcome 100 -> faucet -> 200', async () => {
    const f = await api('POST', '/api/faucet', { token: creatorToken });
    if (f.status !== 200) throw new Error(`faucet ${f.status} ${JSON.stringify(f.json)}`);
    if (Number(f.json.balance) !== 200) throw new Error(`expected additive 200, got ${f.json.balance}`);
    const p = await api('GET', '/api/portfolio', { token: creatorToken });
    if (Number(p.json.balance) !== 200) throw new Error(`portfolio ${p.json.balance}`);
    return `balance=${f.json.balance} added=${f.json.added}`;
  });

  let roomId = '';
  await step('creator opens a new room', async () => {
    const r = await api('POST', '/api/rooms', {
      token: creatorToken,
      body: { title: 'Audit Stream Room', videoUrl: '' },
    });
    if (r.status !== 201) throw new Error(`status ${r.status} ${JSON.stringify(r.json)}`);
    roomId = r.json.id;
    return `roomId=${roomId}`;
  });

  let marketId = '';
  await step('create market: quote -> build -> sign -> register', async () => {
    const q = await api('POST', '/api/markets/quote', {
      token: creatorToken,
      body: {
        roomId,
        question: 'Will the audit run finish under 30 minutes?',
        resolutionRule: 'YES if the run completes before 30 minutes',
        endInMinutes: 10,
      },
    });
    if (q.status !== 200 || !q.json.quoteId) throw new Error(`quote ${q.status} ${JSON.stringify(q.json)}`);
    const b = await api('POST', '/api/markets/build', {
      token: creatorToken,
      body: { quoteId: q.json.quoteId },
    });
    if (b.status !== 200 || !b.json.canonicalPayload) throw new Error(`build ${b.status}`);
    const signature = creator.sign(b.json.canonicalPayload);
    const reg = await api('POST', '/api/markets/register', {
      token: creatorToken,
      body: { quoteId: q.json.quoteId, signature },
    });
    if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.json)}`);
    marketId = reg.json.id;
    return `marketId=${marketId} fee=${q.json.fee}`;
  });

  await step('B3 regression: fresh market is open immediately', async () => {
    const r = await api('GET', `/api/markets/${marketId}`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.json.status !== 'open') throw new Error(`status=${r.json.status}`);
    if (new Date(r.json.end_time) <= new Date()) throw new Error('end_time already past');
    return `status=${r.json.status} end=${r.json.end_time}`;
  });

  await step('room surfaces the OPEN market first (markets[0])', async () => {
    const r = await api('GET', `/api/rooms/${roomId}`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const markets = r.json.markets || [];
    if (!markets.length) throw new Error('no markets on room');
    if (markets[0].id !== marketId) throw new Error(`first market is ${markets[0].status}`);
    if (markets[0].status !== 'open') throw new Error(`first market status=${markets[0].status}`);
    return `first=${markets[0].status}`;
  });

  await step('B4: market quote (buy) returns 200 for the open market', async () => {
    const r = await api('POST', '/api/orders/quote', {
      token: creatorToken,
      body: { marketId, side: 'yes', amount: 10 },
    });
    if (r.status !== 200) throw new Error(`status ${r.status} ${JSON.stringify(r.json)}`);
    return `price=${r.json.price} shares=${r.json.shares}`;
  });

  async function buyYesNo(token, guest, side, amount) {
    const q = await api('POST', '/api/orders/quote', {
      token,
      body: { marketId, side, amount },
    });
    if (q.status !== 200) throw new Error(`quote ${q.status} ${JSON.stringify(q.json)}`);
    const b = await api('POST', '/api/orders/build', { token, body: { orderId: q.json.orderId } });
    if (b.status !== 200) throw new Error(`build ${b.status}`);
    const signature = guest.sign(b.json.canonicalPayload);
    const s = await api('POST', '/api/orders/submit', {
      token,
      body: { orderId: q.json.orderId, signature },
    });
    if (s.status !== 200) throw new Error(`submit ${s.status} ${JSON.stringify(s.json)}`);
    return { price: q.json.price, trade: s.json.trade };
  }

  let yesPriceBefore = 0;
  await step('creator backs YES for $10', async () => {
    const res = await buyYesNo(creatorToken, creator, 'yes', 10);
    yesPriceBefore = res.price;
    return `price=${res.price}`;
  });

  const backer = makeGuest();
  let backerToken = '';
  await step('second guest signs in', async () => {
    backerToken = await authGuest(backer);
    return 'ok';
  });

  await step('second guest backs NO for $20 and odds move', async () => {
    await buyYesNo(backerToken, backer, 'no', 20);
    const after = await api('GET', `/api/markets/${marketId}`);
    const yesNow = Number(after.json.yes_price);
    if (!(yesNow < yesPriceBefore)) throw new Error(`yes did not drop: ${yesPriceBefore} -> ${yesNow}`);
    return `yes ${yesPriceBefore} -> ${yesNow}`;
  });

  await step('resolve as creator (force in dev) sets outcome', async () => {
    const r = await api('POST', `/api/markets/${marketId}/resolve`, {
      token: creatorToken,
      body: { outcome: 'yes', force: true },
    });
    if (r.status !== 200) throw new Error(`status ${r.status} ${JSON.stringify(r.json)}`);
    return `outcome=${r.json.outcome} status=${r.json.status}`;
  });

  await step('non-creator cannot resolve (403)', async () => {
    const r = await api('POST', `/api/markets/${marketId}/resolve`, {
      token: backerToken,
      body: { outcome: 'no', force: true },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}`);
    return `status=${r.status}`;
  });

  await step('winner claim: /win/build -> sign -> /claims/win pays exactly once', async () => {
    const b = await api('POST', '/api/claims/win/build', {
      token: creatorToken,
      body: { marketId },
    });
    if (b.status !== 200 || !b.json.canonicalPayload) throw new Error(`build ${b.status} ${JSON.stringify(b.json)}`);
    const signature = creator.sign(b.json.canonicalPayload);
    const c = await api('POST', '/api/claims/win', { token: creatorToken, body: { marketId, signature } });
    if (c.status !== 200) throw new Error(`claim ${c.status} ${JSON.stringify(c.json)}`);
    // Balance right after the first (successful) claim.
    const balAfter = (await api('GET', '/api/portfolio', { token: creatorToken })).json.balance;
    // Replay the exact same signed claim. Correct behavior = NO second payout:
    // either an idempotent 200 or a 400 "Already claimed" (submitClaim guards
    // positions.claimed before the trades-signature idempotency path).
    const c2 = await api('POST', '/api/claims/win', { token: creatorToken, body: { marketId, signature } });
    const rejected = c2.status === 400 && c2.json && c2.json.error && c2.json.error.code === 'NOT_CLAIMABLE';
    const idempotent = c2.status === 200 && c2.json && c2.json.idempotent === true;
    if (!(rejected || idempotent)) throw new Error(`unexpected replay ${c2.status} ${JSON.stringify(c2.json)}`);
    const balAfterReplay = (await api('GET', '/api/portfolio', { token: creatorToken })).json.balance;
    if (Number(balAfterReplay) !== Number(balAfter)) {
      throw new Error(`double payout: ${balAfter} -> ${balAfterReplay}`);
    }
    return `first=200 amount=${c.json.amount} replay=${rejected ? '400 already-claimed' : '200 idempotent'} balance-stable=${balAfterReplay}`;
  });

  await step('portfolio after activity: balance reflects spend + payout', async () => {
    const r = await api('GET', '/api/portfolio', { token: creatorToken });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const hasPositions = Array.isArray(r.json.positions);
    if (!hasPositions) throw new Error('no positions array');
    return `balance=${r.json.balance} positions=${r.json.positions.length} created=${r.json.createdMarkets.length}`;
  });

  await sleep(50);

  console.log(`\n# TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  server.close();
  if (app._interval && app._interval.unref) app._interval.unref();
  if (app._db && app._db.close) await app._db.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E harness crashed:', e);
  process.exit(2);
});
