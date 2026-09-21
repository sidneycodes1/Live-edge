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
  const hub = createHub();
  const priceCache = createPriceCache({ ttlMs: 10000 });
  const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));

  const { globalLimiter, authLimiter, ordersLimiter, chatLimiter } = createRateLimiters();
  app.use(globalLimiter);

  // health (no /api prefix)
  app.use(healthRouter(db));

  // public routes
  app.use('/api/config', configRouter(env));

  // auth (rate limited)
  app.use('/api/auth', authLimiter, authRouter({ db, env }));

  // streaming (public)
  app.use('/api/stream', streamRouter({ hub }));

  // catalog public
  // rooms public (list/detail)
  const auth = createAuth(env);
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
    marketsRouter({ db, panta, hub, priceCache }),
  );

  // orders (auth + limiter)
  app.use('/api/orders', auth, ordersLimiter, ordersRouter({ db, panta, hub }));

  // portfolio (auth)
  app.use('/api/portfolio', auth, portfolioRouter({ db, panta }));

  // claims (auth)
  app.use('/api/claims', auth, claimsRouter({ db, panta }));

  // chat (auth + limiter)
  app.use('/api/chat', auth, chatLimiter, chatRouter({ db, hub }));

  // streamer metrics (auth)
  app.use('/api/streamer', auth, streamerRouter({ db, panta }));

  // faucet (auth)
  app.use('/api/faucet', auth, faucetRouter({ db }));

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
  app._interval = interval;

  return app;
}
