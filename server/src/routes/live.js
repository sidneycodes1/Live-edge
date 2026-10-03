import { Router } from 'express';
import { LIVE_SOURCES } from '../aggregator/schema.js';

// GET /api/live — the public HTTP face of the never-empty multi-source grid.
// This is a thin, NEVER-500 mapping of the aggregator's internal AggResult (§3) to
// the frozen §3 wire shape; the aggregator already guarantees every provider call is
// timeout/retry/breaker/bulkhead-guarded and degrades to [] instead of throwing.
//
//   AggResult { items, sources:{[name]:count}, degraded:[{source,reason}],
//               usedStale, usedFloor, generatedAt:number }
//     → HTTP   { items, count, servedFrom:'live'|'stale'|'floor'|'empty',
//               generatedAt:<ISO>, sources:{ <name>:{enabled,ok,count,degraded,reason?} } }
//
// Embed/chat URLs are NOT emitted here (§1): the frontend builds them from
// source + channelSlug/watchUrl + /api/config's parent.
//
// §3 mandates this endpoint NEVER 500s. In the happy path that guarantee comes from
// the aggregator never throwing; defensively we ALSO catch an unexpected crash and
// serve the honest-empty shape (servedFrom:'empty') so the landing grid degrades to
// "no channels right now" instead of a blank/broken network response.
function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function servedFrom({ usedStale, usedFloor, count }) {
  if (usedStale) return 'stale';
  if (usedFloor) return 'floor';
  if (count === 0) return 'empty';
  return 'live';
}

// Fixed key set in ladder order so the client always sees all four sources, enabled
// or not, real or degraded. `reason` carries the ProviderError.code (§5) ONLY while
// degraded (§3), letting the UI show an honest "using last results / demo floor".
function buildSources(enabled, sourceCounts, degraded) {
  const sources = {};
  for (const name of LIVE_SOURCES) {
    const isEnabled = Boolean(enabled[name]);
    const deg = (degraded || []).find((d) => d.source === name);
    const isDegraded = Boolean(deg);
    const entry = {
      enabled: isEnabled,
      // ok = the source was tried and its call did not fail (may still be count 0).
      ok: isEnabled && !isDegraded,
      count: Number((sourceCounts || {})[name]) || 0,
      degraded: isDegraded,
    };
    if (isDegraded) entry.reason = deg.reason || 'ERROR';
    sources[name] = entry;
  }
  return sources;
}

export function liveRouter({ aggregator, enabled = {}, warn = (msg) => console.warn(msg) }) {
  const r = Router();

  // GET /api/live?category=football — the API-Football DATA feed (docs/football-api.md).
  // A DIFFERENT, deliberately-narrower envelope from the generic §3 grid: `sources`
  // is the single-provider array, and servedFrom is 'live'|'stale'|'disabled'|'empty'
  // (there is no 'floor' rung — football never substitutes a config stand; empty is an
  // honest empty). Football items do NOT leak into the generic grid this phase.
  async function serveFootball(req, res) {
    const limit = clampInt(req.query.limit, 1, 100, 12);
    if (typeof aggregator.getFootballMatches !== 'function') {
      // Aggregator without football support (e.g. an older stub) → honest empty.
      res.json({ items: [], count: 0, servedFrom: 'disabled', generatedAt: new Date().toISOString(), sources: ['football-api'] });
      return;
    }
    let out;
    try {
      out = await aggregator.getFootballMatches(limit);
    } catch (e) {
      // Never 500 (§3): an unexpected throw becomes an honest empty football feed.
      warn(`live route: football feed threw, serving honest-empty (${e && e.message})`);
      out = { items: [], status: 'empty', generatedAt: Date.now() };
    }
    const items = out.items || [];
    const status = out.status || (items.length > 0 ? 'live' : 'empty');
    res.json({
      items,
      count: items.length,
      servedFrom: status,
      generatedAt: new Date(out.generatedAt ?? Date.now()).toISOString(),
      sources: ['football-api'],
    });
  }

  r.get('/', async (req, res) => {
    // Football is a data feed, not part of the mixed grid — branch BEFORE the generic
    // path so the no-category / other-category behavior stays byte-identical.
    if (String(req.query.category || '').toLowerCase() === 'football') return serveFootball(req, res);

    const limit = clampInt(req.query.limit, 1, 100, 24);
    let agg;
    try {
      agg = await aggregator.getChannels(limit);
    } catch (e) {
      // Never-500 contract (§3): an unexpected aggregator crash becomes an honest
      // empty grid, with every enabled source flagged degraded so the UI can say so.
      warn(`live route: aggregator threw, serving honest-empty (${e && e.message})`);
      const crashed = LIVE_SOURCES.filter((n) => enabled[n]).map((source) => ({ source, reason: 'INTERNAL' }));
      res.json({
        items: [],
        count: 0,
        servedFrom: 'empty',
        generatedAt: new Date().toISOString(),
        sources: buildSources(enabled, {}, crashed),
      });
      return;
    }

    const items = agg.items || [];
    res.json({
      items,
      count: items.length,
      servedFrom: servedFrom({ usedStale: agg.usedStale, usedFloor: agg.usedFloor, count: items.length }),
      // §3 wants an ISO string; the aggregator emits a numeric epoch (AggResult).
      generatedAt: new Date(agg.generatedAt ?? Date.now()).toISOString(),
      sources: buildSources(enabled, agg.sources, agg.degraded),
    });
  });

  return r;
}
