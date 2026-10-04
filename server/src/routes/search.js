import { Router } from 'express';

// ---------------------------------------------------------------------------
// GET /api/search?q=<term> — keyless, quota-free search over the SAME live data
// the landing grid already serves. It fans out to the aggregator's merged grid
// (real Twitch/Kick/YouTube/Floor channels + the quota-free curated 24/7 fill)
// and the cached API-Football fixtures, then does a plain case-insensitive
// contains-match. It NEVER fabricates a result: an empty query or no matches
// returns empty arrays. It never 500s — a provider/aggregator failure degrades
// to an honest empty for that bucket so the search UI can say "no matches".
//
// YouTube SEARCH is intentionally NOT called here: its quota is frequently
// exhausted (429) and it is expensive; the curated RSS fill already surfaces the
// same real channels without a key. (docs/live-aggregation-spec.md §4 honesty.)
// ---------------------------------------------------------------------------

function contains(hay, needle) {
  return String(hay == null ? '' : hay).toLowerCase().includes(needle);
}

// A stream/live item matches on title, channel, owner, or category.
function streamMatches(it, q) {
  return contains(it?.title, q) || contains(it?.channelName, q) || contains(it?.owner, q) || contains(it?.category, q);
}

// A football fixture matches on its title, league, country, or the Football tag.
function footballMatches(it, q) {
  return contains(it?.title, q) || contains(it?.league, q) || contains(it?.country, q) || contains(it?.category, q);
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function searchRouter({ aggregator, warn = (msg) => console.warn(msg) } = {}) {
  const r = Router();

  r.get('/', async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = clampInt(req.query.limit, 1, 50, 24);
    const empty = { query: q, items: [], football: [], count: 0 };
    if (!q || typeof aggregator !== 'object' || aggregator == null) {
      res.json(empty);
      return;
    }

    let items = [];
    let football = [];

    try {
      if (typeof aggregator.getChannels === 'function') {
        const agg = await aggregator.getChannels(50);
        items = (agg.items || []).filter((it) => streamMatches(it, q)).slice(0, limit);
      }
    } catch (e) {
      warn(`search: live grid unavailable → skipping stream results (${e && (e.code || e.message)})`);
    }

    try {
      if (typeof aggregator.getFootballMatches === 'function') {
        const fb = await aggregator.getFootballMatches(50);
        football = (fb.items || []).filter((it) => footballMatches(it, q)).slice(0, limit);
      }
    } catch (e) {
      warn(`search: football feed unavailable → skipping match results (${e && (e.code || e.message)})`);
    }

    res.json({ query: q, items, football, count: items.length + football.length });
  });

  return r;
}
