import { Router } from 'express';
import { makeLiveChannel, bucketForCategory } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// GET /api/search?q=<term> — keyless search with REAL depth (Phase 2, Oct 2026).
// Three tiers, merged and contains-filtered; it NEVER fabricates a result:
//   1. KICK DEEP PAGE — the full first page of /livestreams (limit 100, the
//      API max) fetched DIRECTLY for a search, not the aggregator's rotating
//      50-row grid cache. This is what fixes "searching a live creator finds
//      nothing because they aren't in this minute's rotation".
//   2. AGGREGATOR GRID — YouTube rotation + curated 24/7 + floor rows, merged
//      on top (id-deduped) so a query matching a non-Kick channel still hits.
//   3. YOUTUBE SEARCH FALLBACK — fired ONLY when tiers 1+2 produced zero hits
//      (quota honesty: one cheap conditional call, never on the happy path).
// Exact-slug resolution rides alongside: a slug-shaped q asks Kick's Channels
// endpoint directly and includes the channel ONLY if it is live right now.
// It never 500s — each tier degrades to an honest empty so the UI can show
// "no matches". (docs/live-aggregation-spec.md §4 honesty.)
//
// (API-Football retired Oct 2026 — the cached fixture bucket is gone with it.)
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

// Merge tiers without duplicating the same real row (ids are source-namespaced).
function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    if (!it) continue;
    const key = it.id || `${it.source}:${it.channelSlug || it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// A Kick channel handle looks like a single lowercase token (alnum + -/_), 2..40 chars.
// Used to decide when to run an EXACT slug lookup vs. a plain contains-filter.
function looksLikeChannelSlug(q) {
  return /^[a-z0-9](?:[a-z0-9_-]{1,39})$/.test(String(q || ''));
}

export function searchRouter({ aggregator, kick, youtube, warn = (msg) => console.warn(msg) } = {}) {
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

    // Tier 1: the FULL Kick first page (100 = API max), fetched directly for
    // the search. Cache-aside inside the client (45s) keeps repeat searches
    // free; a Kick failure serves stale/[] and never throws.
    try {
      if (kick && typeof kick.getTopLiveChannels === 'function') {
        items = dedupeById(items.concat(await kick.getTopLiveChannels(100)));
      }
    } catch (e) {
      warn(`search: kick deep page unavailable → skipping it (${e && (e.code || e.message)})`);
    }

    // Tier 2: the merged aggregator grid (YouTube rotation, curated fill,
    // floor) — the same real rows the landing shows, merged on top.
    try {
      if (typeof aggregator.getChannels === 'function') {
        const agg = await aggregator.getChannels(50);
        items = dedupeById(items.concat(agg.items || []));
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
            items = dedupeById([hit, ...items]);
          }
        }
      }
    } catch (e) {
      warn('search: kick slug lookup failed -> skipping exact hit (' + (e && (e.code || e.message)) + ')');
    }

    items = items.filter((it) => streamMatches(it, q)).slice(0, limit);

    // Tier 3 (fallback, LAST RESORT): only when nothing real matched — ask
    // YouTube search directly. Rows come back source-labelled 'youtube', so
    // the UI badges them honestly (s4 empty-section fallback reuses this).
    if (items.length === 0 && youtube && typeof youtube.searchLive === 'function') {
      try {
        const yt = (await youtube.searchLive(q, 10)).filter((it) => streamMatches(it, q));
        items = dedupeById(items.concat(yt)).slice(0, limit);
      } catch (e) {
        warn(`search: youtube fallback unavailable → serving empty (${e && (e.code || e.message)})`);
      }
    }

    res.json({ query: q, items, count: items.length });
  });

  return r;
}
