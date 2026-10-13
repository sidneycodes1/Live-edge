import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

test('CORS_ORIGIN permits each comma-separated allowed origin only', async () => {
  const env = { NODE_ENV: 'test', PORT: 0, JWT_SECRET: 'test-secret-32-chars-long-1234567890', CORS_ORIGIN: 'https://one.example, https://two.example', PANTA_MODE: 'sim', PANTA_BASE_URL: 'https://live-api.panta.market/api/v1', effectiveMode: 'sim', warnings: [] };
  const db = await createDb(env);
  await migrate(db);
  const app = await createApp({ env, db });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const origin of ['https://one.example', 'https://two.example']) {
      const res = await fetch(`${base}/health`, { headers: { Origin: origin } });
      assert.equal(res.headers.get('access-control-allow-origin'), origin);
    }
    const blocked = await fetch(`${base}/health`, { headers: { Origin: 'https://blocked.example' } });
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  } finally {
    app._interval && clearInterval(app._interval);
    app._engine?.stop?.(); app._pantaSync?.stop?.(); app._spectator?.stop?.(); app._hub?.stop?.();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
