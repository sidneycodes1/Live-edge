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
    'TRUNCATE TABLE users, auth_nonces, rooms, markets, orders, trades, balances, positions, chat_messages, notifications, mint_events RESTART IDENTITY CASCADE',
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
