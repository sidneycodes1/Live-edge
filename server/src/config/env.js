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
  // Multi-source live feed (feature/streaming-ui-overhaul → live-aggregation).
  // Every source is OPTIONAL and creds-gated exactly like Twitch: flag on + creds
  // present = real calls; otherwise the source self-degrades (never a crash). The
  // per-source *_ENABLED flags let us turn a provider off at the edge (kill switch)
  // independent of creds. Strict 'true'/'false' enums (no loose boolean coercion).
  LIVE_TWITCH_ENABLED: z.enum(['true', 'false']).default('true'),
  LIVE_KICK_ENABLED: z.enum(['true', 'false']).default('true'),
  LIVE_YOUTUBE_ENABLED: z.enum(['true', 'false']).default('true'),
  LIVE_FLOOR_ENABLED: z.enum(['true', 'false']).default('true'),
  // Kick Developer API (client-credentials app token, mirrors Twitch Helix).
  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),
  KICK_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
  // YouTube Data API v3 (single API key, no OAuth).
  YOUTUBE_API_KEY: z.string().optional(),
  // Free-text query used to seed the live search; "live" surfaces broad live cams.
  YOUTUBE_LIVE_QUERY: z.string().default('live'),
  YOUTUBE_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
  // Floor (Livepeer): optional Studio discovery key + the network-free guaranteed
  // fallback channel that terminates the never-empty ladder. FLOOR_LIVEPEER_URL is
  // the only field required for the guarantee; the rest are cosmetic.
  LIVEPEER_API_KEY: z.string().optional(),
  LIVEPEER_HLS_BASE: z.string().default('https://stream.livepeer.com'),
  FLOOR_LIVEPEER_URL: z.string().optional(),
  FLOOR_TITLE: z.string().optional(),
  FLOOR_CHANNEL_NAME: z.string().optional(),
  FLOOR_CATEGORY: z.string().optional(),
  FLOOR_THUMBNAIL_URL: z.string().optional(),
  FLOOR_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
});

function isEnabled(v) {
  return v === 'true';
}

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
  // Per-source "live feed" enablement = kill-switch flag AND creds. This is what the
  // aggregator + /api/config consume; a source is only tried when its entry is true.
  const kickEnabled = !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET);
  const youtubeEnabled = !!env.YOUTUBE_API_KEY;
  const floorHasFallback = !!env.FLOOR_LIVEPEER_URL;
  const floorHasDiscovery = !!env.LIVEPEER_API_KEY;
  const liveSources = {
    twitch: isEnabled(env.LIVE_TWITCH_ENABLED) && twitchEnabled,
    kick: isEnabled(env.LIVE_KICK_ENABLED) && kickEnabled,
    youtube: isEnabled(env.LIVE_YOUTUBE_ENABLED) && youtubeEnabled,
    // Floor's core job (the guaranteed last rung) needs only FLOOR_LIVEPEER_URL; the
    // discovery key is an optional extra. On if flagged AND it can contribute either.
    floor: isEnabled(env.LIVE_FLOOR_ENABLED) && (floorHasFallback || floorHasDiscovery),
  };
  // Loud-but-non-fatal signals so an operator knows which providers will be silent.
  if (isEnabled(env.LIVE_KICK_ENABLED) && !kickEnabled) {
    warnings.push('KICK_CLIENT_ID/KICK_CLIENT_SECRET missing → Kick contributes no live channels');
  }
  if (isEnabled(env.LIVE_YOUTUBE_ENABLED) && !youtubeEnabled) {
    warnings.push('YOUTUBE_API_KEY missing → YouTube contributes no live channels');
  }
  if (isEnabled(env.LIVE_FLOOR_ENABLED) && !floorHasFallback && !floorHasDiscovery) {
    warnings.push('FLOOR_LIVEPEER_URL/LIVEPEER_API_KEY missing → the never-empty floor cannot guarantee a channel');
  }
  const floorFallback = {
    url: env.FLOOR_LIVEPEER_URL || '',
    title: env.FLOOR_TITLE || '',
    channelName: env.FLOOR_CHANNEL_NAME || '',
    category: env.FLOOR_CATEGORY || '',
    thumbnailUrl: env.FLOOR_THUMBNAIL_URL || '',
  };
  return { ...env, effectiveMode: mode, twitchEnabled, liveSources, floorFallback, warnings };
}
