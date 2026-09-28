// Dev-only audit API server: boots the real app on :4000 with an in-memory
// PGlite and sim mode so the web UI can be driven in a real browser without
// the unreachable hosted Postgres referenced by the committed .env.
// Not part of runtime; used only by the audit browser run.
import { loadEnv } from '../server/src/config/env.js';
import { createApp } from '../server/src/app.js';

const env = loadEnv({
  NODE_ENV: 'test', // in-memory PGlite + bypass IP rate limits for the demo run
  PORT: '4000',
  DATABASE_URL: '',
  JWT_SECRET: 'audit-browser-secret-audit-browser-secret',
  CORS_ORIGIN: 'http://localhost:5173',
  PANTA_MODE: 'sim',
  PANTA_BASE_URL: 'https://live-api.panta.market/api/v1',
});

const app = await createApp({ env });
const server = app.listen(4000, () => {
  console.log(`AUDIT_API_READY http://localhost:4000 mode=${env.effectiveMode} db=pglite-inmemory`);
});
server.on('error', (e) => {
  console.error('AUDIT_API_ERROR', e.message);
  process.exit(1);
});
