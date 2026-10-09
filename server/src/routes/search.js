import { Router } from 'express';
import { makeLiveChannel, bucketForCategory } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// GET /api/search?q=<term> — keyless, quota-free search over the SAME live data
// the landing grid already serves. It fans out to the aggregator's merged grid
// (real Kick/YouTube/Floor channels + the quota-free curated 24/7 fill), then
// does a plain case-insensitive contains-match. It NEVER fabricates a result:
// an empty query or no matches returns empty arrays. It never 500s — a
// provider/aggregator failure degrades to an honest empty so the search UI can
// say "no matches".
//
// (API-Football retired Oct 2026 — the cached fixture bucket is gone with it.)
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

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// A Kick channel handle looks like a single lowercase token (alnum + -/_), 2..40 chars.
// Used to decide when to run an EXACT slug lookup vs. a plain contains-filter.
function looksLikeChannelSlug(q) {
  return /^[a-z0-9](?:[a-z0-9_-]{1,39})$/.test(String(q || ''));
}

export function searchRouter({ aggregator, kick, warn = (msg) => console.warn(msg) } = {}) {
  const r = Router();

  r.get('/', async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = clampInt(req.query.limit, 1, 50, 24);
    const empty = { query: q, items: [], count: 0 };
    if (!q || typeof aggregator !== 'object' || aggregator == null) {
      res.json(empty);
      return;
    }

    let items = [];

    try {
      if (typeof aggregator.getChannels === 'function') {
        const agg = await aggregator.getChannels(50);
        items = (agg.items || []).filter((it) => streamMatches(it, q)).slice(0, limit);
      }
    } catch (e) {
      warn(`search: live grid unavailable → skipping stream results (${e && (e.code || e.message)})`);
    }

    // Exact channel-slug resolution (BUILD_CONTRACT sec 5 / Agent B): when q looks like a
    // single Kick channel handle, ask Kick directly and include the channel ONLY if it is
    // live right now. A non-live/unknown slug is never a hit and we never fabricate a row;
    // the contains-filter above still covers the Kick browse list.
    try {
      if (kick && typeof kick.getChannelBySlug === 'function' && looksLikeChannelSlug(q)) {
        const ch = await kick.getChannelBySlug(q);
        if (ch && ch.isLive) {
          const hit = makeLiveChannel({
            source: 'kick',
            nativeId: ch.broadcasterUserId || ch.slug,
            title: ch.title,
            channelName: ch.displayName || ch.slug,
            channelSlug: ch.slug,
            category: ch.category,
            viewerCount: ch.viewerCount,
            startedAt: ch.startedAt,
            thumbnailUrl: '',
            isLive: true,
            watchUrl: ch.slug ? 'https://kick.com/' + encodeURIComponent(ch.slug) : null,
            language: ch.language,
            bucket: bucketForCategory(ch.category),
          });
          if (!items.some((it) => it && it.id === hit.id)) {
            items = [hit, ...items].slice(0, limit);
          }
        }
      }
    } catch (e) {
      warn('search: kick slug lookup failed -> skipping exact hit (' + (e && (e.code || e.message)) + ')');
    }

    res.json({ query: q, items, count: items.length });
  });

  return r;
}
