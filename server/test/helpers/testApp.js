import { createApp } from '../../src/app.js';
import { createDb } from '../../src/db/index.js';
import { migrate } from '../../src/db/migrate.js';

export async function makeApp() {
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
  const db = await createDb(env);
  await migrate(db);
  const app = await createApp({ env, db });
  const server = app.listen(0);
  await new Promise(r=> server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  async function fetchJson(path, opts={}) {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
    const json = await res.json().catch(()=> ({}));
    return { res, json };
  }
  return { app, db, server, base, fetchJson, env, close: async()=>{ server.close(); await db.close(); clearInterval(app._interval); app._hub.stop(); } };
}
