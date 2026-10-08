import { Router } from 'express';

// Thin, cached wrapper around the Kick client for the Discover "Live on Kick"
// grid + creator channel validation. Public (no auth). Never 500s: the client
// already degrades to [] when creds are missing / Kick is down, so we just
// surface `enabled` + `source` so the frontend can render a clean empty/degraded
// state instead of a raw error. Docs cited in ../kick/client.js (livestreams +
// channels). This router replaces the retired routes/twitch.js 1:1 in shape.
function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function kickRouter({ kick, enabled = false }) {
  const r = Router();

  r.get('/live', async (req, res, next) => {
    try {
      const limit = clampInt(req.query.limit, 1, 100, 12);
      const items = await kick.getTopLiveChannels(limit);
      res.json({
        items,
        // enabled=true means creds are configured and this is real Kick data.
        // enabled=false means demo/fallback mode (no real API calls happened).
        enabled: Boolean(enabled),
        source: enabled ? 'kick' : 'demo',
        count: items.length,
      });
    } catch (e) {
      next(e);
    }
  });

  // Validate a creator-entered channel (exists even if offline / is live).
  // Public single lookup. Never 500s: returns verifiable:false when creds
  // are absent so the UI can say "couldn't verify" instead of silently accepting.
  r.get('/validate', async (req, res, next) => {
    try {
      const slug = String(req.query.slug || '').trim();
      if (!slug) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'slug required' } });
      const v = await kick.validateChannel(slug);
      res.json({ valid: Boolean(v.exists), ...v });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
