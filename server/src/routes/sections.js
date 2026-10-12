import { Router } from 'express';
import { bucketForCategory, isFootballStream } from '../aggregator/schema.js';

// ---------------------------------------------------------------------------
// GET /api/live/sections — the four landing sections, pre-bucketed SERVER-side.
//
// KICK PRIMARY, YOUTUBE BACKUP (owner rule, Oct 2026 — now AUTOMATIC, no prompts):
// every section fills from REAL rows in strict priority, and a section that ends up
// with nothing simply stays empty (the UI hides it — never an empty filler block):
//   1. Kick rows fill their `bucket` sections. Kick-first is absolute: a section with
//      ANY Kick row never shows a non-Kick row. Kick is no longer STARVED by a hard
//      English filter — the aggregator ranks English Kick ahead of non-English but
//      KEEPS both, so a live Kick broadcast always earns its own section instead of
//      handing it to YouTube (the old filter made Kick look empty, which is exactly
//      why the grid flooded with YouTube).
//   2. A bucket with ZERO Kick rows is filled, in order, from the OTHER real rows
//      already present: (a) merged YouTube/floor provider rows (routed by
//      bucketForCategory of their source-native category), then (b) the quota-free
//      curated 24/7 channels. Each is labelled fallback:true + sourceLabel:'YouTube'
//      so the UI badges it honestly (real, just not Kick).
//   3. The generic youtube.searchLive filler was REMOVED (Oct 2026): it was the
//      quota-burning rung (100 units/query) that surfaced dead or VOD rows and only
//      fired once English filtering emptied a section. The verified, keyless curated
//      24/7 list is now the ONLY YouTube backup — it never dies on quota.
//   4. Anything failing (aggregator crash, YouTube down, no creds) degrades to an
//      HONEST empty bucket — we never fabricate a stream (§1 honesty).
// ---------------------------------------------------------------------------

const SECTION_KEYS = ['sports', 'news', 'irl', 'games'];
// Default rows per section; matches the collapsed→expanded 3×3 grid the landing
// renders. The honest ceiling for a YouTube-backed bucket.
const PER_SECTION_DEFAULT = 6;

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Label a real, non-Kick row so the tile badges it honestly ("via YouTube") and the
// section note explains the backfill. Curated 24/7 rows come from the curated client
// (a raw shape with no isLive/watchUrl/bucket), so this also fills the LiveChannel
// fields the tile reads. Never invents a stream — it only labels rows that are real.
function labelReal(it, bucket) {
  return {
    ...it,
    bucket,
    fallback: true,
    sourceLabel: 'YouTube',
    isLive: it.isLive == null ? true : it.isLive,
    watchUrl: it.watchUrl == null ? (it.videoUrl || null) : it.watchUrl,
  };
}

export function sectionsRouter({ aggregator, curated, warn = (msg) => console.warn(msg), now = () => Date.now() } = {}) {
  const r = Router();

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
      // Same never-500 contract as /api/live: an honest empty grid (we cannot even
      // prove a section is empty — it may just be down — so nothing is fabricated).
      warn(`live sections: aggregator unavailable → serving honest empty (${e && (e.code || e.message)})`);
      res.json(emptyResponse);
      return;
    }

    // One pass splits Kick vs the other real rows. Kick-first is preserved exactly
    // (a section with ANY Kick row never shows a non-Kick row); a Kick row keeps its
    // server-derived bucket, a non-Kick row routes by bucketForCategory of its
    // source-native category. English Kick rows already rank ahead of non-English in
    // agg.items (aggregator English-first sort), so filling in that order leads with
    // English while never dropping a live Kick broadcast.
    const kickBuckets = { sports: [], news: [], irl: [], games: [] };
    const altBuckets = { sports: [], news: [], irl: [], games: [] };
    for (const it of agg.items || []) {
      if (!it) continue;
      const bucket = it.source === 'kick' ? it.bucket : bucketForCategory(it.category);
      if (!SECTION_KEYS.includes(bucket)) continue;
      const dest = it.source === 'kick' ? kickBuckets[bucket] : altBuckets[bucket];
      if (dest.length < perSection) dest.push(it);
    }

    // Curated always-live 24/7 channels (keyless + quota-free) — fetched ONLY when a
    // section is still empty after Kick + merged YouTube/floor. This is the ONLY
    // YouTube backup rung now that the searchLive filler is gone.
    let curatedBuckets = null;
    const needsCurated = SECTION_KEYS.some((k) => kickBuckets[k].length === 0 && altBuckets[k].length === 0);
    if (needsCurated && typeof curated?.getChannels === 'function') {
      curatedBuckets = { sports: [], news: [], irl: [], games: [] };
      let curatedRows = [];
      try {
        curatedRows = (await curated.getChannels()) || [];
      } catch (e) {
        warn(`live sections: curated fetch failed → skipping curated fill (${e && (e.code || e.message)})`);
      }
      for (const c of curatedRows) {
        if (!c) continue;
        const bucket = bucketForCategory(c.category);
        if (!SECTION_KEYS.includes(bucket)) continue;
        if (curatedBuckets[bucket].length < perSection) curatedBuckets[bucket].push(labelReal(c, bucket));
      }
    }

    const buckets = { sports: [], news: [], irl: [], games: [] };
    const fallbackUsed = {};
    for (const key of SECTION_KEYS) {
      if (kickBuckets[key].length > 0) { buckets[key] = kickBuckets[key]; continue; } // kick-first
      if (altBuckets[key].length > 0) {
        buckets[key] = altBuckets[key].map((it) => labelReal(it, key));
        fallbackUsed[key] = true;
        continue;
      }
      if (curatedBuckets && curatedBuckets[key].length > 0) {
        buckets[key] = curatedBuckets[key];
        fallbackUsed[key] = true;
        continue;
      }
      // Nothing real for this section → honest empty (the UI hides it; never filler).
    }

    // P3 (owner ask, Oct 2026): when a genuinely-live FOOTBALL broadcast is present
    // in the Sports section, POP IT to the top. Pure re-ordering of rows we already
    // have — it never calls an API and never invents a match. V8's sort is stable, so
    // non-football rows keep their Kick-then-viewers order underneath the pinned ones.
    if (buckets.sports.length > 1) {
      buckets.sports = [...buckets.sports].sort(
        (a, b) => (isFootballStream(b) ? 1 : 0) - (isFootballStream(a) ? 1 : 0),
      );
    }
    buckets.sports.forEach((it) => {
      if (it && typeof it === 'object' && isFootballStream(it)) it.pinnedFootball = true;
    });
    const footballLive = buckets.sports.length > 0 && isFootballStream(buckets.sports[0]);

    const anyItems = SECTION_KEYS.some((k) => buckets[k].length > 0);
    res.json({
      items: buckets,
      fallbackUsed,
      footballLive,
      servedFrom: agg.usedStale ? 'stale' : agg.usedFloor ? 'floor' : anyItems ? 'live' : 'empty',
      generatedAt: new Date(agg.generatedAt ?? now()).toISOString(),
    });
  });

  return r;
}
