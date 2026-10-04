import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadDotEnv } from './config/dotenv.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';

// Load .env from the repo root (falling back to the server dir) before reading config.
// Precedence: real process.env wins, so an explicit shell/env var overrides the file.
const dot = loadDotEnv();
// Boot diagnostic: which .env was read and the raw mode value. Never print secrets.
console.warn(
  `LiveEdge env: dotenv=${dot.loaded ? 'loaded' : 'not-found'} path=${dot.path} ` +
    `applied=${dot.parsed} rawPANTA_MODE=${process.env.PANTA_MODE ?? '(unset)'}`,
);

const env = loadEnv(process.env);
// handle port busy
let port = env.PORT;

async function start() {
  const db = await createDb(env);
  await migrate(db);
  await seed(db, { fallbackChannel: env.TWITCH_FALLBACK_CHANNEL });
  const app = await createApp({ env, db });
  for (const w of env.warnings || []) console.warn(w);
  console.warn(`LiveEdge effectiveMode=${env.effectiveMode} requested=${env.PANTA_MODE}`);
  // F-019: production loadEnv() already hard-fails on the fallback secret. In any
  // other env print a loud (but non-fatal) signal so a dev-facing default is never
  // mistaken for a deployable secret.
  if (env.JWT_SECRET.startsWith('dev-only')) {
    console.warn('!! JWT_SECRET is the built-in dev fallback. Set a real JWT_SECRET before deploying — tokens are forgeable otherwise. !!');
  }

  const server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port} mode=${env.effectiveMode}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const next = port + 1;
      console.warn(`Port ${port} busy, trying ${next}`);
      port = next;
      server.listen(port);
    } else {
      console.error(err);
      process.exit(1);
    }
  });

  // graceful
  process.on('SIGTERM', async () => {
    clearInterval(app._interval);
    if (app._engine && app._engine.stop) app._engine.stop();
    hubStop(app);
    await db.close();
    server.close(() => process.exit(0));
  });
}

function hubStop(app) {
  try { app._hub.stop(); } catch {
    // Ignore hub stop errors
  }
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
