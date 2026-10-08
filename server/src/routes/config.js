import { Router } from 'express';

export function configRouter(env) {
  const r = Router();
  r.get('/', (_req, res) => {
    res.json({
      mode: env.effectiveMode,
      requestedMode: env.PANTA_MODE,
      warnings: env.warnings || [],
      features: {
        liveReads: env.effectiveMode !== 'sim',
        previewBuy: env.effectiveMode === 'hybrid',
        // Per-source live-feed booleans, derived from creds only (§7). A source is
        // "live" for the grid iff its client has something to call.
        kickLive: Boolean(env.liveSources && env.liveSources.kick),
        youtubeLive: Boolean(env.liveSources && env.liveSources.youtube),
        floorLive: Boolean(env.liveSources && env.liveSources.floor),
      },
      // Per-source config for the multi-provider grid (§7). Only ever `enabled` /
      // public labels — never a secret or token. Kick is the primary real-stream
      // source (Twitch retired Oct 2026); its embed needs no domain config.
      kick: {
        enabled: Boolean(env.liveSources && env.liveSources.kick),
        fallbackChannel: env.KICK_FALLBACK_CHANNEL || '',
      },
      youtube: { enabled: Boolean(env.liveSources && env.liveSources.youtube) },
      floor: {
        enabled: Boolean(env.liveSources && env.liveSources.floor),
        hlsBase: env.FLOOR_HLS_BASE || '',
      },
      // Panta real-time integration status (Door 1). Non-secret: whether the live
      // poller runs + the freshness window after which the UI honestly relabels a
      // price "stale". The API key itself NEVER appears here (server-only).
      panta: {
        realtimeEnabled: Boolean(env.pantaRealtimeEnabled ?? (env.PANTA_REALTIME_ENABLED === 'true' && env.PANTA_API_KEY)),
        pollIntervalMs: env.PANTA_POLL_INTERVAL_MS || 15000,
        priceStaleAfterMs: env.PANTA_PRICE_STALE_AFTER_MS || 60000,
      },
      sim: {
        feeBps: env.SIM_FEE_BPS,
        graduationVolume: env.SIM_GRADUATION_VOLUME,
        liquidityB: env.SIM_LIQUIDITY_B,
      },
    });
  });
  return r;
}
