import { Router } from 'express';

// Thin, cached wrapper around Phase A's Twitch client for the Discover "Live on
// Twitch" grid. Public (no auth). Never 500s: the client already degrades to []
// when creds are missing / Helix is down, so we just surface `enabled` +
// `source` so the frontend can render a clean empty/degraded state instead of a
// raw error. Docs cited in ../twitch/client.js (get-streams).
function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function twitchRouter({ twitch, enabled = false }) {
  const r = Router();

  r.get('/live', async (req, res, next) => {
    try {
      const limit = clampInt(req.query.limit, 1, 100, 12);
      const items = await twitch.getTopLiveStreams(limit);
      res.json({
        items,
        // enabled=true means creds are configured and this is real Twitch data.
        // enabled=false means demo/fallback mode (no real Helix calls happened).
        enabled: Boolean(enabled),
        source: enabled ? 'twitch' : 'demo',
        count: items.length,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
