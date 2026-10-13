import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  // Boot patience for a managed Postgres (Neon suspends idle computes, and the first
  // connection after a wake takes seconds). Held unknown ON PURPOSE like the other
  // lenient knobs: a malformed value degrades to the environment default in
  // db/index.js instead of crashing boot.
  PG_CONNECT_TIMEOUT_MS: z.unknown().optional(),
  PG_CONNECT_ATTEMPTS: z.unknown().optional(),
  ALLOW_PGLITE_IN_PROD: z.enum(['true', 'false']).optional(),
  PGLITE_DATA_DIR: z.string().optional(),
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
  // Multi-source live feed (docs/live-aggregation-spec.md §7). Every key is
  // OPTIONAL: an absent cred disables that source (no boot error) and its client
  // self-degrades with a startup warning. Strict parsing; secrets never
  // logged/echoed.
  // Kick Developer API (client-credentials app token) — the PRIMARY real-stream
  // provider since the Twitch retirement (Oct 2026). A reliably-live 24/7 channel
  // slug may be bound to the seed gaming room so "always live" is genuinely real.
  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),
  KICK_FALLBACK_CHANNEL: z.string().optional(),
  KICK_CACHE_TTL_MS: z.coerce.number().min(1000).default(45000),
  // YouTube Data API v3 (single API key). YOUTUBE_QUERY seeds the live search.
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_QUERY: z.string().default('live'),
  // Phase 3 (Tier-B): optional pipe-separated queries that REPLACE YOUTUBE_QUERY.
  // Format "query[:Category]|query[:Category]" — Category is an operator-assigned
  // curation label (same semantics as the curated list's category tag), never
  // source-fabricated data. Each query costs 100 search units per refresh.
  YOUTUBE_QUERIES: z.string().optional(),
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
  // (API-Football DATA integration retired Oct 2026 — the football vertical was removed
  // whole: no provider, no env vars, no /api/live?category=football.)
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
  // Cloudflare Workers AI - the durable FREE fallback in the LLM failover chain
  // (Gemini -> Cloudflare -> OpenRouter). Enabled ONLY when BOTH a token and an
  // account id are present. Secrets: never logged/echoed, never in a tracked file.
  // The model must be one of the JSON-Mode-capable text-generation models.
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_AI_MODEL: z.string().default('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
  CLOUDFLARE_BUDGET_PER_DAY: z.unknown().optional(),
  // OpenRouter - the last-resort EMERGENCY provider (free tier is ~50 req/day, so it
  // is intentionally ordered last). Enabled ONLY when a key is present. Secret.
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct:free'),
  OPENROUTER_BUDGET_PER_DAY: z.unknown().optional(),
  // Aggregate attempts/day ceiling for the market engine across ALL providers (a
  // runaway guard, distinct from each provider's own cap). Lenient like the others:
  // a bad value degrades to the engine default with a warning, never a boot crash.
  LLM_BUDGET_PER_DAY: z.unknown().optional(),
  // Privy auth (docs/PRIVY_AUTH_SPEC.md). OPTIONAL + STRICT, same degrade policy as
  // every other provider: absent creds DISABLE Privy session auth (the route answers
  // 503) rather than crashing boot. Both are secrets — never logged/echoed, never in
  // a tracked file or test fixture.
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  // Panta real-time integration (Door 1: real catalog/prices/outcomes + Panta's
  // settlement LOGIC, run against our SIMULATED $100 ledger — never the chain).
  // The whole feature is OFF unless the operator explicitly flips it on AND a
  // server-only PANTA_API_KEY is present, so an accidental boot can never start
  // polling Panta or spend a mainnet key. Everything degrades honestly: an
  // unreachable upstream keeps the last-known price and never fabricates one
  // (ToU §5). PANTA_API_KEY stays server-only — it is NEVER forwarded to the web
  // bundle (only VITE_* vars reach the browser). See services/pantaSync.js.
  PANTA_REALTIME_ENABLED: z.enum(['true', 'false']).optional(),
  // Poll cadence for the single process-wide Panta read (list endpoint batches many
  // markets per call; the read budget is 120 req/60s, so this must stay coarse).
  PANTA_POLL_INTERVAL_MS: z.coerce.number().min(1000).default(15000),
  // A mirrored Panta price older than this is honestly relabeled 'stale_panta' (the
  // UI shows "Updated Xs ago / Stale") rather than presented as a live quote.
  PANTA_PRICE_STALE_AFTER_MS: z.coerce.number().min(1000).default(60000),
  // Bounded band (basis points, measured from the flat 0.5 mid) for OUR OWN
  // simulated price movement where a Panta market has no live price. Clamps the
  // drift so a simulated number can never masquerade as a real market signal.
  SIM_DRIFT_MAX_BPS: z.coerce.number().min(0).max(10000).default(2000),
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
  // Per-source enablement is derived from creds/config ONLY (§7: "booleans from
  // creds"). No separate kill-switch env exists — that was a divergence from the
  // frozen spec and has been removed so /api/config's features match §7 exactly.
  // Kick is the primary real-stream source: no creds → honest demo/fallback mode
  // (empty browse list), never a crash.
  const kickEnabled = !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET);
  const youtubeEnabled = !!env.YOUTUBE_API_KEY;
  // Tier-B multi-query: parsed leniently (garbage segments are dropped, boot
  // never crashes). Empty → the client keeps its single YOUTUBE_QUERY behavior.
  const youtubeQueries = (env.YOUTUBE_QUERIES || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.lastIndexOf(':');
      const cat = i > 0 ? s.slice(i + 1).trim() : '';
      if (i > 0 && /^[A-Za-z][A-Za-z /-]{0,29}$/.test(cat)) {
        return { q: s.slice(0, i).trim(), category: cat };
      }
      return { q: s };
    });
  const floorHasFallback = !!env.FLOOR_FALLBACK_URL;
  const floorHasDiscovery = !!env.LIVEPEER_API_KEY;
  // Floor is "enabled" if it can contribute EITHER live discovery (key) OR the
  // guaranteed network-free fallback card (url).
  const floorEnabled = floorHasFallback || floorHasDiscovery;
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
  const liveSources = { kick: kickEnabled, youtube: youtubeEnabled, floor: floorEnabled };
  // LLM failover chain for the broadcast market engine: Gemini (primary) ->
  // Cloudflare Workers AI (durable free fallback) -> OpenRouter (emergency). Each is
  // enabled from its creds ONLY; an absent provider is simply skipped by the chain.
  // The engine ROTATES only when at least one provider is enabled (llmEnabled); with
  // none, it is DISABLE-SAFE (keeps the last batch, never crashes, never fabricates).
  const geminiEnabled = Boolean(env.GEMINI_API_KEY);
  const cloudflareEnabled = Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
  const openrouterEnabled = Boolean(env.OPENROUTER_API_KEY);
  const llmEnabled = geminiEnabled || cloudflareEnabled || openrouterEnabled;
  // Loud-but-non-fatal, per-provider: an operator should know which rungs are silent.
  // Gemini is the PRIMARY, so its absence is always called out (the chain still falls
  // through to Cloudflare/OpenRouter when those are configured).
  if (!geminiEnabled) warnings.push('GEMINI_API_KEY missing → Gemini disabled in the LLM chain (falls through to Cloudflare/OpenRouter when configured)');
  if (!llmEnabled) {
    warnings.push('No LLM provider key (GEMINI/CLOUDFLARE/OPENROUTER) → market engine rotation disabled (no crash; existing markets kept)');
  }
  // Privy session auth (docs/PRIVY_AUTH_SPEC.md). Enabled ONLY when both creds are
  // present; otherwise disabled with a startup notice (never a crash). Guests are
  // unaffected — this gates the Privy exchange endpoint alone.
  const privyEnabled = Boolean(env.PRIVY_APP_ID && env.PRIVY_APP_SECRET);
  if (!privyEnabled) {
    warnings.push('PRIVY_APP_ID/PRIVY_APP_SECRET missing → Privy session auth disabled (POST /auth/privy/session returns 503; guest + wallet sign-in unaffected)');
  }
  // Panta real-time integration gate (Door 1). Enabled ONLY when the operator
  // explicitly turns it on AND a server-only PANTA_API_KEY exists — the same
  // creds-derived degrade as every other provider. Off ⇒ the poller never starts,
  // markets keep serving sim/simulated prices, and NOTHING is fabricated. A stray
  // 'true' with no key is a startup warning, never a crash or a live poll.
  const pantaRealtimeEnabled = env.PANTA_REALTIME_ENABLED === 'true' && Boolean(env.PANTA_API_KEY);
  if (env.PANTA_REALTIME_ENABLED === 'true' && !env.PANTA_API_KEY) {
    warnings.push('PANTA_REALTIME_ENABLED=true but PANTA_API_KEY missing → Panta real-time sync disabled (markets stay simulated, never fabricated)');
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
    kickEnabled,
    liveSources,
    youtubeQueries,
    floorFallback,
    geminiEnabled,
    cloudflareEnabled,
    openrouterEnabled,
    llmEnabled,
    privyEnabled,
    pantaRealtimeEnabled,
    simBetWindowMin,
    warnings,
  };
}
