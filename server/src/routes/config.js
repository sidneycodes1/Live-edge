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
        twitchLive: Boolean(env.liveSources ? env.liveSources.twitch : env.twitchEnabled),
        kickLive: Boolean(env.liveSources && env.liveSources.kick),
        youtubeLive: Boolean(env.liveSources && env.liveSources.youtube),
        floorLive: Boolean(env.liveSources && env.liveSources.floor),
      },
      // Public, non-secret Twitch embed config (kept for back-compat). `parentDomain`
      // must equal the bare hosting domain (no protocol) per dev.twitch.tv/docs/embed/;
      // empty → frontend falls back to location.hostname. Never includes creds.
      twitch: {
        enabled: Boolean(env.twitchEnabled),
        parentDomain: env.TWITCH_PARENT_DOMAIN || '',
        fallbackChannel: env.TWITCH_FALLBACK_CHANNEL || '',
      },
      // Per-source config for the multi-provider grid (§7). Only ever `enabled` /
      // `hlsBase` — never a secret or token.
      kick: { enabled: Boolean(env.liveSources && env.liveSources.kick) },
      youtube: { enabled: Boolean(env.liveSources && env.liveSources.youtube) },
      floor: {
        enabled: Boolean(env.liveSources && env.liveSources.floor),
        hlsBase: env.FLOOR_HLS_BASE || '',
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
