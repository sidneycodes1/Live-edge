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
        twitchLive: Boolean(env.twitchEnabled),
      },
      // Public, non-secret Twitch embed config. `parentDomain` must equal the
      // bare hosting domain (no protocol) per dev.twitch.tv/docs/embed/;
      // empty → frontend falls back to location.hostname. Never includes creds.
      twitch: {
        enabled: Boolean(env.twitchEnabled),
        parentDomain: env.TWITCH_PARENT_DOMAIN || '',
        fallbackChannel: env.TWITCH_FALLBACK_CHANNEL || '',
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
