import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';

const env = loadEnv(process.env);
// handle port busy
let port = env.PORT;

async function start() {
  const db = await createDb(env);
  await migrate(db);
  await seed(db);
  const app = await createApp({ env, db });
  for (const w of env.warnings || []) console.warn(w);
  console.warn(`LiveEdge effectiveMode=${env.effectiveMode} requested=${env.PANTA_MODE}`);

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
