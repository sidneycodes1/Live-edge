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
  // API-Football DATA integration (docs/football-api.md — Phase 1 of the Football
  // Live Bets Overhaul). OPTIONAL + STRICT, same degrade policy as every live
  // provider (§7): a provider that isn't 'api-football' or a missing key DISABLES
  // the feature with a startup warning — it never crashes boot. The key is a secret:
  // never logged/echoed, never written to a tracked file or test fixture. Coerce is
  // left off SIM_BET_WINDOW_MIN so a garbage value falls back to 30 (validated in
  // loadEnv) instead of throwing at parse time.
  FOOTBALL_API_PROVIDER: z.string().optional(),
  FOOTBALL_API_KEY: z.string().optional(),
  FOOTBALL_API_BASE_URL: z.string().url().default('https://v3.football.api-sports.io'),
  // Held as unknown ON PURPOSE: coercion + validation happen in loadEnv so a
  // malformed value degrades to the default with a warning rather than crashing the
  // whole schema parse (the app must always boot — §7 degrade policy).
  SIM_BET_WINDOW_MIN: z.unknown().optional(),
  // Gemini (broadcast market engine). OPTIONAL + STRICT like every other provider:
  // an absent key just DISABLES the feature (no boot crash, no network call). The key
  // is a secret — never logged/echoed, never written to a tracked file or fixture.
  // When enabled, services/marketEngine.js rotates live-born markets; the daily call
  // budget defaults to 40 and can be lowered/raised via GEMINI_BUDGET_PER_DAY.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_BUDGET_PER_DAY: z.unknown().optional(),
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
  // API-Football data feed (§ docs/football-api.md). Enabled ONLY when the provider
  // is exactly 'api-football' AND a key is present. A wrong provider or missing key
  // disables it with a startup warning (never a crash) so the app still boots and
  // category=football serves an honest empty feed. The key itself is never logged.
  const footballProviderOk = env.FOOTBALL_API_PROVIDER === 'api-football';
  const footballHaskey = Boolean(env.FOOTBALL_API_KEY);
  const footballApiEnabled = footballProviderOk && footballHaskey;
  if (env.FOOTBALL_API_PROVIDER && !footballProviderOk) {
    warnings.push(`FOOTBALL_API_PROVIDER="${env.FOOTBALL_API_PROVIDER}" unsupported → football data API disabled (only 'api-football' is implemented)`);
  } else if (!footballApiEnabled) {
    warnings.push('FOOTBALL_API_KEY missing or FOOTBALL_API_PROVIDER!=api-football → football data API disabled (category=football serves an honest empty feed)');
  }
  // SIM_BET_WINDOW_MIN: positive integer, validated leniently — a bad/NaN value
  // falls back to 30 with a warning rather than crashing boot.
  let simBetWindowMin = 30;
  if (env.SIM_BET_WINDOW_MIN != null && env.SIM_BET_WINDOW_MIN !== '') {
    const n = Number(env.SIM_BET_WINDOW_MIN);
    if (Number.isInteger(n) && n >= 1) {
      simBetWindowMin = n;
    } else {
      warnings.push('SIM_BET_WINDOW_MIN must be a positive integer → falling back to 30');
    }
  }
  const liveSources = { twitch: twitchEnabled, kick: kickEnabled, youtube: youtubeEnabled, floor: floorEnabled };
  // Gemini feature flag (Phase 2 groundwork). Derived from the key's presence ONLY;
  // no creds → feature disabled with a startup notice, never a crash. No other Gemini
  // behavior is wired this phase (market generation is next).
  const geminiEnabled = Boolean(env.GEMINI_API_KEY);
  if (!geminiEnabled) {
    warnings.push('GEMINI_API_KEY missing → Gemini features disabled (no crash; model would use GEMINI_MODEL if enabled)');
  }
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
  return {
    ...env,
    effectiveMode: mode,
    twitchEnabled,
    liveSources,
    floorFallback,
    footballApiEnabled,
    geminiEnabled,
    simBetWindowMin,
    warnings,
  };
}
