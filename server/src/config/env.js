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
  // Multi-source live feed (docs/live-aggregation-spec.md §7). Every key is
  // OPTIONAL: an absent cred disables that source (no boot error) and its client
  // self-degrades exactly like Twitch. Strict parsing; secrets never logged/echoed.
  // Kick Developer API (client-credentials app token, mirrors Twitch Helix).
  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),
  KICK_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
  // YouTube Data API v3 (single API key). YOUTUBE_QUERY seeds the live search.
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_QUERY: z.string().default('live'),
  YOUTUBE_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
  // Floor = the self-hosted terminal rung (§3). FLOOR_PROVIDER selects the backend
  // (only 'livepeer' this round); LIVEPEER_API_KEY is optional Studio discovery;
  // FLOOR_FALLBACK_URL is the network-free guaranteed channel that makes the grid
  // never-empty. The remaining FLOOR_FALLBACK_* fields are cosmetic labels for that
  // one card (§1 forbids inventing data, so a thumbnail is intentionally absent).
  FLOOR_PROVIDER: z.enum(['livepeer']).default('livepeer'),
  LIVEPEER_API_KEY: z.string().optional(),
  FLOOR_HLS_BASE: z.string().default('https://stream.livepeer.com'),
  FLOOR_FALLBACK_URL: z.string().optional(),
  FLOOR_FALLBACK_TITLE: z.string().optional(),
  FLOOR_FALLBACK_CHANNEL: z.string().optional(),
  FLOOR_FALLBACK_CATEGORY: z.string().optional(),
  FLOOR_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
  // Grid-level cache TTL (§3 step 4). Parsed per §7 and forwarded to the
  // aggregator; the base aggregator currently leans on each client's own cache —
  // this is the contract hook for the verifier's grid-cache decision.
  LIVE_CACHE_TTL_MS: z.coerce.number().min(1000).default(30000),
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
  // Per-source enablement is derived from creds/config ONLY (§7: "booleans from
  // creds"). No separate kill-switch env exists — that was a divergence from the
  // frozen spec and has been removed so /api/config's features match §7 exactly.
  const kickEnabled = !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET);
  const youtubeEnabled = !!env.YOUTUBE_API_KEY;
  const floorHasFallback = !!env.FLOOR_FALLBACK_URL;
  const floorHasDiscovery = !!env.LIVEPEER_API_KEY;
  // Floor is "enabled" if it can contribute EITHER live discovery (key) OR the
  // guaranteed network-free fallback card (url).
  const floorEnabled = floorHasFallback || floorHasDiscovery;
  const liveSources = { twitch: twitchEnabled, kick: kickEnabled, youtube: youtubeEnabled, floor: floorEnabled };
  // Loud-but-non-fatal signals so an operator knows which providers will be silent.
  if (!kickEnabled) warnings.push('KICK_CLIENT_ID/KICK_CLIENT_SECRET missing → Kick contributes no live channels');
  if (!youtubeEnabled) warnings.push('YOUTUBE_API_KEY missing → YouTube contributes no live channels');
  if (!floorEnabled) warnings.push('FLOOR_FALLBACK_URL/LIVEPEER_API_KEY missing → the never-empty floor cannot guarantee a channel');
  // Shape the floor CLIENT expects (its `fallback` arg); thumbnailUrl is intentionally
  // empty per §1/§4 (no fabricated preview).
  const floorFallback = {
    url: floorHasFallback ? env.FLOOR_FALLBACK_URL : '',
    title: env.FLOOR_FALLBACK_TITLE || '',
    channelName: env.FLOOR_FALLBACK_CHANNEL || '',
    category: env.FLOOR_FALLBACK_CATEGORY || '',
    thumbnailUrl: '',
  };
  return { ...env, effectiveMode: mode, twitchEnabled, liveSources, floorFallback, warnings };
}
