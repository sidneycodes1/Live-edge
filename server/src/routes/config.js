import { Router } from 'express';

export function configRouter(env) {
  const r = Router();
  r.get('/config', (_req, res) => {
    res.json({
      mode: env.effectiveMode,
      requestedMode: env.PANTA_MODE,
      warnings: env.warnings || [],
      features: {
        liveReads: env.effectiveMode !== 'sim',
        previewBuy: env.effectiveMode === 'hybrid',
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
