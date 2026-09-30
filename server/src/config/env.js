import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  ALLOW_PGLITE_IN_PROD: z.enum(['true', 'false']).optional(),
  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-dev-only-secret'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PANTA_MODE: z.enum(['sim', 'hybrid', 'live']).default('sim'),
  PANTA_BASE_URL: z.string().url().default('https://live-api.panta.market/api/v1'),
  PANTA_API_KEY: z.string().optional(),
  SOLANA_RPC_URL: z.string().optional(),
  SIM_FEE_BPS: z.coerce.number().default(200),
  SIM_CREATOR_SHARE_BPS: z.coerce.number().default(2500),
  SIM_GRADUATION_VOLUME: z.coerce.number().default(100),
  SIM_LIQUIDITY_B: z.coerce.number().default(50),
  SIM_CREATE_FEE: z.coerce.number().min(0).default(1),
  // Twitch live integration (feature/twitch-live-integration). All optional so the
  // app boots and degrades to demo/fallback mode when creds are absent — the exact
  // same policy as PANTA_API_KEY. Never logged/echoed (see integrity rules).
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  TWITCH_FALLBACK_CHANNEL: z.string().optional(),
  // Embed `parent` must be the bare hosting domain (no protocol) per
  // dev.twitch.tv/docs/embed/video-and-clips/. Driven by env, not hardcoded, so it
  // doesn't silently break on deploy. Empty → frontend derives it from location.hostname.
  TWITCH_PARENT_DOMAIN: z.string().optional(),
  TWITCH_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
});

export function loadEnv(raw = process.env) {
  const env = schema.parse(raw);
  const warnings = [];
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL && env.ALLOW_PGLITE_IN_PROD !== 'true') {
    throw new Error('DATABASE_URL must be set in production. To use PGlite in production, set ALLOW_PGLITE_IN_PROD=true');
  }
  let mode = env.PANTA_MODE;
  if (mode !== 'sim' && !env.PANTA_API_KEY) {
    warnings.push(`PANTA_MODE=${mode} but PANTA_API_KEY missing → running in sim mode`);
    mode = 'sim';
  }
  // Twitch: real Helix calls / embeds need both creds. Missing → demo/fallback mode
  // (labeled), never a crash. Mirrors the Panta downgrade above.
  const twitchEnabled = !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
  if (!twitchEnabled) {
    warnings.push('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET missing → Twitch live browse runs in demo/fallback mode (no real Helix calls)');
  }
  return { ...env, effectiveMode: mode, twitchEnabled, warnings };
}
