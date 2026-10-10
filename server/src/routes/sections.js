import { Router } from 'express';
import { isEnglishStream } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// GET /api/live/sections — the four landing sections, pre-bucketed SERVER-side,
// with the Phase-2 empty-section fallback (owner ask, Oct 2026: "if a section
// has no live streams, fall back to YouTube and LABEL the source").
//
// Rules, in order (docs/BUILD_CONTRACT-browse-ui-chat.md §4 + the s4 amendment):
//   1. Kick rows from the merged grid fill their `bucket` sections (kick-first
//      is still the default — a section with Kick rows NEVER shows YouTube).
//   2. A bucket with ZERO Kick rows gets real live YouTube videos appended
//      (one conditional youtube.searchLive per empty section, rows carry
//      source:'youtube' + fallback:true + sourceLabel:'YouTube' so the UI can
//      badge them honestly). Never on the happy path — quota honesty.
//   3. Strict English: every served row passes isEnglishStream (an untagged
//      YouTube row is not provably non-English, same rule as the grid).
//   4. Anything failing (aggregator crash, YouTube down, no creds) degrades to
//      an HONEST empty bucket — we never fabricate a stream (§1 honesty).
//
// YouTube fallback results are cached per query (FALLBACK_TTL_MS) so a refresh
// storm can't burn the Data-API search quota (each search = 100 units).
// ---------------------------------------------------------------------------

// Operator fallback queries per section — English terms, deliberately broad so
// YouTube live search returns real currently-live rooms, not VODs (the client
// keeps only liveBroadcastContent==='live' and prunes proven-ended streams).
export const FALLBACK_QUERIES = {
  sports: 'sports live',
  news: 'news live',
  irl: 'just chatting live',
  games: 'gaming live',
};

const SECTION_KEYS = ['sports', 'news', 'irl', 'games'];
const FALLBACK_TTL_MS = 180000; // 3 min per query (quota-bounded refresh)
// Default rows per section: the honest ceiling for a YouTube-filled bucket, and
// it matches the collapsed→expanded 3×3 grid the landing renders.
const PER_SECTION_DEFAULT = 6;

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function sectionsRouter({ aggregator, youtube, warn = (msg) => console.warn(msg), now = () => Date.now() } = {}) {
  const r = Router();
  // query → { at, items } — one cache line per operator query, never per user.
  const fallbackCache = new Map();

  // One conditional YouTube live search per section, cached, deduped, English-
  // filtered, live-only. Throws are caught by the caller; [] is a valid answer.
  async function fallbackFor(sectionKey, perSection) {
    const q = FALLBACK_QUERIES[sectionKey];
    const at = now();
    const hit = fallbackCache.get(q);
    if (hit && at - hit.at < FALLBACK_TTL_MS) {
      return hit.items.slice(0, perSection);
    }
    const raw = (await youtube.searchLive(q, 10)) || [];
    const items = raw
      .filter((it) => it && it.isLive && isEnglishStream(it))
      .slice(0, 10)
      .map((it) => ({
        ...it,
        // s4 labeling: the UI badges these "via YouTube" — never as Kick rows.
        fallback: true,
        sourceLabel: 'YouTube',
      }));
    fallbackCache.set(q, { at, items });
    return items.slice(0, perSection);
  }

  r.get('/', async (req, res) => {
    const perSection = clampInt(req.query.limit, 1, 9, PER_SECTION_DEFAULT);
    const emptyResponse = {
      items: {},
      fallbackUsed: {},
      servedFrom: 'empty',
      generatedAt: new Date(now()).toISOString(),
    };
    for (const k of SECTION_KEYS) emptyResponse.items[k] = [];

    let agg;
    try {
      agg = await aggregator.getChannels(100);
    } catch (e) {
      // Same never-500 contract as /api/live: an honest empty grid, no fallback
      // fired (we cannot even prove a section is empty — it may just be down).
      warn(`live sections: aggregator unavailable → serving honest empty (${e && (e.code || e.message)})`);
      res.json(emptyResponse);
      return;
    }

    // Kick rows → bucket sections (only fresh live data qualifies for fallback
    // decisions; a stale/floor grid must not trigger YouTube searches).
    const canFallback = !agg.usedStale && !agg.usedFloor && typeof youtube?.searchLive === 'function';
    const buckets = { sports: [], news: [], irl: [], games: [] };
    for (const it of agg.items || []) {
      if (!it || it.source !== 'kick' || !isEnglishStream(it)) continue;
      if (!SECTION_KEYS.includes(it.bucket)) continue;
      if (buckets[it.bucket].length < perSection) buckets[it.bucket].push(it);
    }

    const fallbackUsed = {};
    const searches = [];
    for (const key of SECTION_KEYS) {
      if (buckets[key].length > 0 || !canFallback) continue;
      searches.push(
        fallbackFor(key, perSection)
          .then((items) => {
            buckets[key] = items;
            fallbackUsed[key] = items.length > 0;
          })
          .catch((e) => {
            // Honest empty: a failed fallback never fabricates or blocks others.
            warn(`live sections: ${key} YouTube fallback failed → honest empty (${e && (e.code || e.message)})`);
            fallbackUsed[key] = false;
          }),
      );
    }
    await Promise.all(searches);

    const anyItems = SECTION_KEYS.some((k) => buckets[k].length > 0);
    res.json({
      items: buckets,
      fallbackUsed,
      servedFrom: agg.usedStale ? 'stale' : agg.usedFloor ? 'floor' : anyItems ? 'live' : 'empty',
      generatedAt: new Date(agg.generatedAt ?? now()).toISOString(),
    });
  });

  // introspection for tests / health
  r._fallbackCache = fallbackCache;
  return r;
}
