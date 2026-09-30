import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { loadEnv } from './config/env.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { createPanta } from './panta/index.js';
import { createTwitchClient } from './twitch/client.js';
import { createHub } from './services/sse.js';
import { createPriceCache } from './services/priceCache.js';
import { healthRouter } from './routes/health.js';
import { configRouter } from './routes/config.js';
import { authRouter } from './routes/auth.js';
import { roomsRouter } from './routes/rooms.js';
import { marketsRouter } from './routes/markets.js';
import { ordersRouter } from './routes/orders.js';
import { portfolioRouter } from './routes/portfolio.js';
import { claimsRouter } from './routes/claims.js';
import { chatRouter } from './routes/chat.js';
import { streamRouter } from './routes/stream.js';
import { streamerRouter } from './routes/streamer.js';
import { faucetRouter } from './routes/faucet.js';
import { notificationsRouter } from './routes/notifications.js';
import { twitchRouter } from './routes/twitch.js';
import { ledgerRouter } from './routes/ledger.js';
import { createNotifier } from './services/notify.js';
import { createAuth } from './middleware/auth.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';
import { notFound } from './middleware/notFound.js';

export async function createApp({ env: rawEnv, db: existingDb } = {}) {
  const env = rawEnv || loadEnv(process.env);
  const db = existingDb || (await createDb(env));
  if (!existingDb) {
    await migrate(db);
    await seed(db);
  }
  const panta = createPanta({ db, env });
  // Twitch live client (feature/twitch-live-integration). Always constructed; it
  // self-degrades to [] / null when creds are missing, so no branching needed here.
  const twitch = createTwitchClient({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    cacheTtlMs: env.TWITCH_CACHE_TTL_MS,
  });
  const hub = createHub();
  const notify = createNotifier(db, hub);
  const priceCache = createPriceCache({ ttlMs: 10000 });
  const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

  const app = express();
  // F-008: behind Render / any single reverse proxy every request otherwise
  // shares one IP bucket, so IP-keyed rate limits become ineffective (or one
  // client can get everyone blocked). Trust exactly one hop so req.ip is the
  // real client. Number (not `true`) keeps express-rate-limit's validator happy
  // and avoids trusting an attacker-supplied X-Forwarded-For chain.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));

  const { globalLimiter, authLimiter, ordersLimiter, chatLimiter } = createRateLimiters();
  // In test, a single shared server handles all tests in the file, so IP-based
  // rate limits would leak across tests and flake. Bypass them in test only.
  const passThrough = (_req, _res, next) => next();
  const isTest = env.NODE_ENV === 'test';
  app.use(isTest ? passThrough : globalLimiter);

  // auth middleware (used by protected routes and by authRouter's /me, /logout, /upgrade)
  const auth = createAuth(env);

  // health (no /api prefix)
  app.use(healthRouter(db));

  // public routes
  app.use('/api/config', configRouter(env));

  // auth (rate limited). /nonce and /verify stay public; /me, /logout, /upgrade
  // apply `auth` per-route inside the router.
  app.use('/api/auth', isTest ? passThrough : authLimiter, authRouter({ db, env, auth, notify }));

  // streaming (public)
  app.use('/api/stream', streamRouter({ hub }));

  // Twitch "currently live" browse (public). Reads real Helix when creds exist,
  // otherwise returns an empty/demo list — see routes/twitch.js.
  app.use('/api/twitch', twitchRouter({ twitch, enabled: env.twitchEnabled }));

  // catalog public
  // rooms public (list/detail)
  // need to allow public GET but auth for POST
  app.use('/api/rooms', (req, res, next) => {
    if (req.method === 'POST') return auth(req, res, next);
    next();
  }, roomsRouter({ db, hub }));

  // markets: some public, some auth
  app.use(
    '/api/markets',
    (req, res, next) => {
      if (req.path === '/catalog' || (req.method === 'GET' && req.path.match(/^\/[^/]+$/))) return next();
      return auth(req, res, next);
    },
    marketsRouter({ db, panta, hub, priceCache, notify }),
  );

  // orders (auth + limiter)
  app.use('/api/orders', auth, isTest ? passThrough : ordersLimiter, ordersRouter({ db, panta, hub }));

  // portfolio (auth)
  app.use('/api/portfolio', auth, portfolioRouter({ db, panta }));

  // claims (auth)
  app.use('/api/claims', auth, claimsRouter({ db, panta, notify }));

  // chat (auth + limiter)
  app.use('/api/chat', auth, isTest ? passThrough : chatLimiter, chatRouter({ db, hub }));

  // streamer metrics (auth)
  app.use('/api/streamer', auth, streamerRouter({ db, panta }));

  // faucet (auth)
  app.use('/api/faucet', auth, faucetRouter({ db, notify }));

  // notifications (auth)
  app.use('/api/notifications', auth, notificationsRouter({ db }));

  // transaction history / ledger (auth)
  app.use('/api/ledger', auth, ledgerRouter({ db }));

  // 404
  app.use(notFound);
  app.use(errorHandler);

  // background: close markets every 10s
  const interval = setInterval(async () => {
    try {
      await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);
    } catch {
      // Silently ignore background update errors
    }
  }, 10000);
  if (interval.unref) interval.unref();

  app._db = db;
  app._hub = hub;
  app._env = env;
  app._panta = panta;
  app._twitch = twitch;
  app._interval = interval;

  return app;
}
