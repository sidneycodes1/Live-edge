import { createApp } from '../../src/app.js';
import { createDb } from '../../src/db/index.js';
import { migrate } from '../../src/db/migrate.js';

// ONE PGlite instance per test FILE (module singleton).
// Lifecycle: top-level `before` creates + migrates once,
// `beforeEach` TRUNCATEs all tables cheaply, `after` closes.
// Usage inside describe(name, () => { before(setupTestEnv); beforeEach(resetDb); after(teardownTestEnv); ... })
let sharedDb = null;
let sharedEnv = null;
let sharedApp = null;
let sharedServer = null;
let sharedBase = null;

export async function setupTestEnv() {
  if (sharedDb) return;

  const env = {
    NODE_ENV: 'test',
    PORT: 0,
    JWT_SECRET: 'test-secret-32-chars-long-1234567890',
    CORS_ORIGIN: '*',
    PANTA_MODE: 'sim',
    PANTA_BASE_URL: 'https://live-api.panta.market/api/v1',
    SIM_FEE_BPS: 200,
    SIM_CREATOR_SHARE_BPS: 2500,
    SIM_GRADUATION_VOLUME: 100,
    SIM_LIQUIDITY_B: 50,
    effectiveMode: 'sim',
    warnings: [],
  };

  sharedEnv = env;
  sharedDb = await createDb(env);
  await migrate(sharedDb);
  sharedApp = await createApp({ env, db: sharedDb });
  sharedServer = sharedApp.listen(0);
  await new Promise((r) => sharedServer.once('listening', r));
  const port = sharedServer.address().port;
  sharedBase = `http://127.0.0.1:${port}`;
}

export async function teardownTestEnv() {
  if (!sharedDb) return;

  if (sharedServer) await new Promise((r) => sharedServer.close(r));
  if (sharedApp) {
    if (sharedApp._interval) clearInterval(sharedApp._interval);
    if (sharedApp._engine && sharedApp._engine.stop) sharedApp._engine.stop();
    if (sharedApp._spectator && sharedApp._spectator.stop) sharedApp._spectator.stop();
    if (sharedApp._hub) sharedApp._hub.stop();
  }
  // PGlite close API is db.close() via wrapper (see server/src/db/index.js)
  if (sharedDb) await sharedDb.close();

  sharedDb = null;
  sharedEnv = null;
  sharedApp = null;
  sharedServer = null;
  sharedBase = null;
}

export async function resetDb() {
  if (!sharedDb) throw new Error('DB not initialized - call setupTestEnv first');
  // Single TRUNCATE across all tables with RESTART IDENTITY CASCADE for cheap reset
  await sharedDb.query(
    'TRUNCATE TABLE users, auth_nonces, rooms, markets, orders, trades, balances, positions, chat_messages, notifications, mint_events, fee_events, engine_budget, live_pins RESTART IDENTITY CASCADE',
  );
}

export async function makeApp() {
  if (!sharedDb) {
    throw new Error('Call setupTestEnv() in before() before makeApp()');
  }

  async function fetchJson(path, opts = {}) {
    const res = await fetch(`${sharedBase}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  return {
    app: sharedApp,
    db: sharedDb,
    server: sharedServer,
    base: sharedBase,
    fetchJson,
    env: sharedEnv,
    close: async () => {},
  };
}

// Builds an EXTRA app on the shared test DB with an INJECTED Privy verifier (a fake),
// so privy-auth tests exercise POST /auth/privy/session hermetically — no live network.
// The singleton app (makeApp) has no creds and honestly 503s; this is the injection
// seam the spec calls for ("tests pass a fake"). Caller must close() it.
export async function makePrivyApp(verifyPrivyToken) {
  if (!sharedDb) throw new Error('Call setupTestEnv() in before() before makePrivyApp()');
  const app = await createApp({ env: sharedEnv, db: sharedDb, privyVerifier: verifyPrivyToken });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function fetchJson(p, opts = {}) {
    const res = await fetch(`${base}${p}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }
  async function close() {
    if (app._interval) clearInterval(app._interval);
    if (app._engine && app._engine.stop) app._engine.stop();
    if (app._spectator && app._spectator.stop) app._spectator.stop();
    if (app._hub) app._hub.stop();
    await new Promise((r) => server.close(r));
  }
  return { app, db: sharedDb, base, fetchJson, env: sharedEnv, close };
}

// Marks the current token’s account as having accepted the Terms (POST /api/me/setup),
// so a guest account created via the wallet path can pass the TERMS_REQUIRED gate that
// protects order placement + claims. Trade fixtures call this right after signing in so
// their money assertions stay focused on money, not consent. Returns { res, json }.
export async function acceptTerms(fetchJson, token, overrides = {}) {
  return fetchJson('/api/me/setup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      displayName: 'trader_01',
      interests: ['trading'],
      termsVersion: 'terms-draft-1',
      accepted: true,
      ...overrides,
    }),
  });
}
