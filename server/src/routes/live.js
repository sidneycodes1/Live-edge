import { Router } from 'express';
import { LIVE_SOURCES } from '../aggregator/schema.js';

// Public, never-500 browse endpoint for the resilient multi-source live feed. The
// aggregator (../aggregator/index.js) already guarantees each provider call is
// timeout/retry/breaker/bulkhead-guarded and degrades to [] rather than throwing,
// so this handler mostly surfaces per-source status + the ladder flags (usedStale /
// usedFloor) so the frontend can label a degraded grid instead of showing a blank.
function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function liveRouter({ aggregator, enabled = {} }) {
  const r = Router();

  r.get('/', async (req, res, next) => {
    try {
      const limit = clampInt(req.query.limit, 1, 100, 24);
      const { items, sources = {}, degraded = [], usedStale, usedFloor, generatedAt } = await aggregator.getChannels(limit);
      res.json({
        items,
        count: items.length,
        limit,
        // Which sources are switched on (flag && creds) vs actually returned rows.
        enabled: LIVE_SOURCES.reduce((acc, s) => {
          acc[s] = Boolean(enabled[s]);
          return acc;
        }, {}),
        sources,
        degraded,
        // The ladder ran: real live data was empty, so we served stale cache or the
        // config floor fallback. Lets the UI say "showing cached / fallback".
        usedStale: Boolean(usedStale),
        usedFloor: Boolean(usedFloor),
        // Nothing at all (no live data, no cache, floor unconfigured) — render an
        // empty-but-handled state, never a crash. Distinct from a network error.
        empty: items.length === 0,
        generatedAt,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
