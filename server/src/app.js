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
import { createKickClient } from './kick/client.js';
import { createYouTubeClient } from './youtube/client.js';
import { createFloorClient } from './floor/client.js';
import { createFootballClient } from './football/client.js';
import { createCuratedClient } from './curated/client.js';
import { createGeminiClient } from './gemini/client.js';
import { createMarketEngine } from './services/marketEngine.js';
import { createAiSpectator } from './services/aiChat.js';
import { createLiveAggregator } from './aggregator/index.js';
import { createHub } from './services/sse.js';
import { createPriceCache } from './services/priceCache.js';
import { healthRouter } from './routes/health.js';
import { configRouter } from './routes/config.js';
import { authRouter } from './routes/auth.js';
import { privyRouter } from './routes/privy.js';
import { profileRouter } from './routes/profile.js';
import { createPrivyVerifier } from './privy/verifier.js';
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
import { pinsRouter } from './routes/pins.js';
import { twitchRouter } from './routes/twitch.js';
import { liveRouter } from './routes/live.js';
import { searchRouter } from './routes/search.js';
import { ledgerRouter } from './routes/ledger.js';
import { createNotifier } from './services/notify.js';
import { createAuth } from './middleware/auth.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';
import { notFound } from './middleware/notFound.js';

export async function createApp({ env: rawEnv, db: existingDb, privyVerifier: injectedVerifier } = {}) {
  const env = rawEnv || loadEnv(process.env);
  const db = existingDb || (await createDb(env));
  if (!existingDb) {
    await migrate(db);
    await seed(db, { fallbackChannel: env.TWITCH_FALLBACK_CHANNEL });
  }
  const panta = createPanta({ db, env });
  // Twitch live client (feature/twitch-live-integration). Always constructed; it
  // self-degrades to [] / null when creds are missing, so no branching needed here.
  const twitch = createTwitchClient({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    cacheTtlMs: env.TWITCH_CACHE_TTL_MS,
  });
  // Multi-source live feed (feature/streaming-ui-overhaul → live-aggregation). All
  // clients are always constructed and self-degrade ([] / no network) when creds
  // are absent, exactly like twitch above. `liveSources` comes from loadEnv in prod;
  // the fallback here keeps hand-built test envs (no loadEnv) booting unchanged.
  const kick = createKickClient({
    clientId: env.KICK_CLIENT_ID,
    clientSecret: env.KICK_CLIENT_SECRET,
    cacheTtlMs: env.KICK_CACHE_TTL_MS,
  });
  const youtube = createYouTubeClient({
    apiKey: env.YOUTUBE_API_KEY,
    query: env.YOUTUBE_QUERY,
    // Tier-B (Phase 3): when YOUTUBE_QUERIES is set, the client fans out across
    // them (sequential, deduped) instead of the single generic query.
    queries: env.youtubeQueries?.length ? env.youtubeQueries : null,
    cacheTtlMs: env.YOUTUBE_CACHE_TTL_MS,
  });
  // The floor client's `fallback` arg is the network-free guaranteed card (§3).
  // loadEnv already builds `floorFallback`; the literal here keeps hand-built test
  // envs booting unchanged. thumbnailUrl stays empty (§1/§4: never fabricate a preview).
  const floorFallback = env.floorFallback || {
    url: env.FLOOR_FALLBACK_URL || '',
    title: env.FLOOR_FALLBACK_TITLE || '',
    channelName: env.FLOOR_FALLBACK_CHANNEL || '',
    category: env.FLOOR_FALLBACK_CATEGORY || '',
    thumbnailUrl: '',
  };
  const floor = createFloorClient({
    apiKey: env.LIVEPEER_API_KEY,
    hlsBase: env.FLOOR_HLS_BASE,
    fallback: floorFallback,
    cacheTtlMs: env.FLOOR_CACHE_TTL_MS,
  });
  const liveSources = env.liveSources || {
    twitch: Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET),
    kick: Boolean(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET),
    youtube: Boolean(env.YOUTUBE_API_KEY),
    floor: Boolean(env.FLOOR_FALLBACK_URL || env.LIVEPEER_API_KEY),
  };
  // API-Football DATA feed (docs/football-api.md). Constructed always; it self-
  // disables (throws DISABLED → honest empty) when the provider/key are absent,
  // exactly like the video clients. loadEnv sets `footballApiEnabled`; the fallback
  // keeps hand-built test envs (no loadEnv) booting unchanged.
  const football = createFootballClient({
    provider: env.FOOTBALL_API_PROVIDER,
    apiKey: env.FOOTBALL_API_KEY,
    baseUrl: env.FOOTBALL_API_BASE_URL,
  });
  const footballEnabled = env.footballApiEnabled ?? Boolean(env.FOOTBALL_API_PROVIDER === 'api-football' && env.FOOTBALL_API_KEY);
  // Curated always-live channels (Phase 2). Keyless + quota-free (channel RSS), so it
  // is ALWAYS constructed and available — no creds gate. It's a post-merge FILL inside
  // the aggregator (not a LIVE_SOURCES provider), so the grid still serves real live
  // cards when the YouTube SEARCH budget is exhausted. It self-degrades: a curated
  // outage can never break the general feed. Production pacing (verified 2026-10-04:
  // 14-at-once RSS bursts draw YouTube fake-404 per-IP throttling): bounded
  // concurrency + stagger + one retry; partial refreshes cache only 60s so a
  // throttle blip at boot cannot lock the grid short-filled for 10 minutes.
  const curated = createCuratedClient({ concurrency: 4, staggerMs: 150, retryDelayMs: 1500 });
  // Gemini feature flag: drives whether the broadcast market engine rotates (§ TASK 2).
  const geminiEnabled = env.geminiEnabled ?? Boolean(env.GEMINI_API_KEY);
  // A single enabled map feeds BOTH the aggregator and the route: the four grid
  // sources plus the football data flag (`football` is ignored by the generic grid)
  // and the gemini groundwork flag (consumed by a later phase, not the grid).
  const enabled = { ...liveSources, football: footballEnabled, gemini: geminiEnabled };
  const liveAggregator = createLiveAggregator({ twitch, kick, youtube, floor, football, curated, enabled });
  // Broadcast-aligned market engine (Phase 2). Gemini client is inert without a key
  // (generateJson returns null, no call), so the engine is ALWAYS constructed but a
  // real rotation only runs when the feature is enabled. It never throws at boot and
  // never wipes existing markets — a Gemini outage just keeps the last batch served.
  const gemini = createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  const marketEngine = createMarketEngine({ db, gemini, aggregator: liveAggregator, env });
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

  // Privy server-side auth (docs/PRIVY_AUTH_SPEC.md). The verifier is INJECTED so
  // hermetic tests pass a fake and no live network is touched. With no creds,
  // createPrivyVerifier returns null and the session route honestly answers 503.
  const privyVerifier = injectedVerifier !== undefined ? injectedVerifier : createPrivyVerifier(env);

  // health (no /api prefix)
  app.use(healthRouter(db));

  // public routes
  app.use('/api/config', configRouter(env));

  // auth (rate limited). /nonce and /verify stay public; /me, /logout, /upgrade
  // apply `auth` per-route inside the router.
  app.use(
    '/api/auth',
    isTest ? passThrough : authLimiter,
    authRouter({ db, env, auth, notify }),
    privyRouter({ db, env, verifyPrivyToken: privyVerifier, notify }),
  );

  // User profile (auth): PUT /api/me/profile writes display_name + interests.
  app.use('/api/me', auth, profileRouter({ db }));

  // streaming (public)
  app.use('/api/stream', streamRouter({ hub }));

  // Twitch "currently live" browse (public). Reads real Helix when creds exist,
  // otherwise returns an empty/demo list — see routes/twitch.js.
  app.use('/api/twitch', twitchRouter({ twitch, enabled: env.twitchEnabled }));

  // Resilient multi-source live feed (public): merges Twitch/Kick/YouTube/Floor into
  // LiveChannel[] with a never-empty ladder. Never 500s — see routes/live.js.
  // `?category=football` additionally serves the API-Football DATA feed (docs/football-api.md).
  app.use('/api/live', liveRouter({ aggregator: liveAggregator, enabled }));

  // Keyless, quota-free search over the merged live grid + cached football feed
  // (server/src/routes/search.js). Never 500s; empty query / no matches → honest
  // empty so the UI can show "no matches" rather than a broken spinner.
  app.use('/api/search', searchRouter({ aggregator: liveAggregator }));

  // catalog public
  // rooms public (list/detail)
  // need to allow public GET but auth for POST
  app.use('/api/rooms', (req, res, next) => {
    if (req.method === 'POST') return auth(req, res, next);
    next();
  }, roomsRouter({ db, hub, twitch }));

  // markets: some public, some auth. The GET listing rails (trending/closing/all),
  // /catalog and the single-market detail are public; create/resolve require auth.
  // POST /engine/tick reaches the router without auth so the live proof is a plain
  // curl — the handler itself hard-refuses in production (see routes/markets.js).
  app.use(
    '/api/markets',
    (req, res, next) => {
      const p = req.path;
      const publicGet = req.method === 'GET' && (p === '/' || p === '/catalog' || /^\/[^/]+$/.test(p));
      const devTick = req.method === 'POST' && p === '/engine/tick';
      if (publicGet || devTick) return next();
      return auth(req, res, next);
    },
    marketsRouter({ db, panta, hub, priceCache, notify, engine: marketEngine, env }),
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

  // live pins (auth) — the user's pinned-stream shelf (max 4, leads "Live now").
  app.use('/api/pins', auth, pinsRouter({ db }));

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

  // Start the 30-min market rotation ONLY when Gemini is enabled (an engine with no
  // key would just skip every tick). It kicks once immediately so a fresh boot already
  // has live-born markets, then rotates. The interval is unref'd so it never keeps the
  // process alive, and app teardown (testApp + graceful shutdown) stops it explicitly.
  if (geminiEnabled) marketEngine.start();

  // AI spectator chat: labeled kind='ai' lines in rooms WITHOUT a real provider
  // chat and only while a viewer is connected (see services/aiChat.js honesty
  // contract). Disable with AI_SPECTATOR=off. Unref'd interval; teardown stops it.
  const aiSpectator = createAiSpectator({ db, hub, env });
  // Not auto-started under test: suites assert on chat_messages, and a background
  // spectator would be a flake source. Tests drive tick() directly with fakes.
  if (env.NODE_ENV !== 'test') aiSpectator.start();

  app._db = db;
  app._hub = hub;
  app._env = env;
  app._panta = panta;
  app._twitch = twitch;
  app._liveAggregator = liveAggregator;
  app._liveSources = liveSources;
  app._football = football;
  app._curated = curated;
  app._gemini = gemini;
  app._engine = marketEngine;
  app._spectator = aiSpectator;
  app._interval = interval;

  return app;
}
