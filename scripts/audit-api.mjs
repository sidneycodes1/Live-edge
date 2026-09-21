import { createApp } from '../server/src/app.js';
import { createDb } from '../server/src/db/index.js';
import { migrate } from '../server/src/db/migrate.js';
import { genWallet, sign } from '../server/test/helpers/wallet.js';

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
await new Promise(r => server.once('listening', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let results = [];

async function test(name, path, method, body, headers, expectedStatus, expectedCode) {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    const actualStatus = res.status;
    const actualCode = json.error?.code;
    const pass = actualStatus === expectedStatus && (!expectedCode || actualCode === expectedCode);
    results.push({ name, expectedStatus, actualStatus, expectedCode, actualCode, pass });
  } catch (e) {
    results.push({ name, expectedStatus, actualStatus: 'ERROR', expectedCode, actualCode: e.message, pass: false });
  }
}

const W1 = genWallet();

await test('GET /health', '/health', 'GET', null, null, 200, null);
await test('GET /ready', '/ready', 'GET', null, null, 200, null);
await test('GET /api/config', '/api/config/config', 'GET', null, null, 200, null);
await test('POST /api/auth/nonce', '/api/auth/nonce', 'POST', { wallet: W1.pub }, null, 200, null);
await test('GET /api/rooms', '/api/rooms', 'GET', null, null, 200, null);
await test('GET /api/rooms/:id 404', '/api/rooms/00000000-0000-0000-0000-000000000000', 'GET', null, null, 404, null);
await test('GET /api/markets/catalog', '/api/markets/catalog', 'GET', null, null, 200, null);
await test('GET /api/portfolio 401', '/api/portfolio', 'GET', null, null, 401, null);
await test('POST /api/chat 401', '/api/chat', 'POST', { roomId: 'test', message: 'Hello' }, null, 401, null);

console.log('\nAPI CONTRACT AUDIT RESULTS');
console.log('========================');
console.log('Name | Expected Status | Actual Status | Expected Code | Actual Code | Pass');
console.log('-----|----------------|---------------|---------------|-------------|-----');
for (const r of results) {
  console.log(`${r.name} | ${r.expectedStatus} | ${r.actualStatus} | ${r.expectedCode || 'N/A'} | ${r.actualCode || 'N/A'} | ${r.pass ? 'PASS' : 'FAIL'}`);
}

const allPass = results.every(r => r.pass);
console.log(`\n${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

server.close();
await db.close();
process.exit(allPass ? 0 : 1);
