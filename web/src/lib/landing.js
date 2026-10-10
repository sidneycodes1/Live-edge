// ---------------------------------------------------------------------------
// Kick-first category landing — PURE helpers (no React, no fetch), so the
// routing/slicing rules of docs/BUILD_CONTRACT-browse-ui-chat.md §4 are
// provable without a DOM (web/src/lib/landing.test.js).
//
// Honesty (§1): these functions only re-order/slice/label rows they are GIVEN.
// Nothing is backfilled across buckets, no viewer count is invented, and the
// placeholder-tile gradient is a deterministic function of the channel slug
// (decorative UI, never presented as provider media).
// ---------------------------------------------------------------------------
import { tailorByInterests } from './tailoring.js';
import { mergePinnedFirst, MAX_PINS } from './pins.js';
import { buildVideoEmbed, isEmbedVerified } from './embed.js';

// A section shows 3 cards collapsed; "Show more" reveals up to 9 (3×3). §4.
export const COLLAPSED_COUNT = 3;
export const EXPANDED_COUNT = 9;

// The four landing sections, in render order (§4 table). All four are fed by
// Kick rows' `bucket` (the API-Football match feed that used to back Sports
// was retired Oct 2026).
export const LANDING_SECTIONS = [
  { key: 'sports', title: 'Sports' },
  { key: 'news', title: 'News' },
  { key: 'irl', title: 'IRL' },
  { key: 'games', title: 'Games' },
];

const KICK_BUCKET_KEYS = ['sports', 'news', 'irl', 'games'];

// Group a normalized LiveChannel list into landing buckets. Kick rows route by
// their server-derived `bucket` (§4 — the `bucket` field comes from the server;
// a row without one, or with an unknown value, is tolerant-routed to 'other'
// and 'other' has no landing section, so it simply isn't shown). s4 amendment:
// YouTube-fallback rows (fallback:true, from GET /api/live/sections) join the
// section the SERVER assigned them to — the web never re-derives a bucket.
export function groupKickByBucket(channels = []) {
  const out = { sports: [], news: [], irl: [], games: [], other: [] };
  for (const c of Array.isArray(channels) ? channels : []) {
    if (!c) continue;
    if (c.source === 'kick') {
      const key = KICK_BUCKET_KEYS.includes(c.bucket) ? c.bucket : 'other';
      out[key].push(c);
    } else if (c.fallback === true && KICK_BUCKET_KEYS.includes(c.bucket)) {
      // Source-labelled YouTube fill for an empty section — stays in its section.
      out[c.bucket].push(c);
    }
  }
  return out;
}

// Order law for one landing section (shared by the client-bucketed search view
// and the server-bucketed default view): PINS FIRST → then interest tailoring
// (re-orders only, never filters, never fabricates). Only pins that ACTUALLY
// live in this section's rows lead it — an out-of-section pin must never be
// injected here as a snapshot (that would cross-fill buckets, §1 honesty).
// leadCount=0 keeps tailoring stable when no pin matches.
export function orderLandingRows(rows, pins, interests) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = new Set(list.map((c) => String(c?.id)));
  const sectionPins = (Array.isArray(pins) ? pins : []).filter((p) => p && ids.has(String(p.stream_id)));
  return tailorByInterests(mergePinnedFirst(list, sectionPins), interests, {
    leadCount: Math.min(sectionPins.length, MAX_PINS),
  });
}

// Collapsed → first 3; expanded → first 9. Pure slice, nothing invented.
export function visibleItems(items = [], expanded = false) {
  const list = Array.isArray(items) ? items : [];
  return list.slice(0, expanded ? EXPANDED_COUNT : COLLAPSED_COUNT);
}

// "Show more" only appears when there is genuinely MORE to show.
export function canExpand(items = []) {
  return (Array.isArray(items) ? items.length : 0) > COLLAPSED_COUNT;
}

export function isEmptySection(items = []) {
  return !(Array.isArray(items) && items.length > 0);
}

// The honest empty-state sentence per section (§1: empty is allowed and must
// be shown as empty — never backfilled from another bucket). s4 changed the
// YouTube BACKFILL rule (the server now fills an empty section with labelled
// YouTube rows); when even that produced nothing the sentence stays honest.
export function emptyStateLabel(sectionKey) {
  const s = LANDING_SECTIONS.find((x) => x.key === sectionKey);
  const title = s ? s.title : 'this';
  return `No live ${title} streams on Kick or the YouTube fallback right now.`;
}

// ---------------------------------------------------------------------------
// Placeholder-tile gradient — the tile that replaces a thumbnail Kick does not
// expose. Deterministic: same channelSlug → same gradient on every render and
// every visit (no Math.random, no time). FNV-1a 32-bit over the slug string.
// ---------------------------------------------------------------------------
export function slugHash(slug) {
  const s = String(slug || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function tileGradient(slug) {
  const h = slugHash(slug);
  const angle = h % 360;
  const hueA = (h >>> 9) % 360;
  const hueB = (hueA + 60 + ((h >>> 21) % 120)) % 360;
  return `linear-gradient(${angle}deg, hsl(${hueA} 72% 42%) 0%, hsl(${hueB} 78% 22%) 100%)`;
}

// The channel initial shown over the gradient. Real name/slug only; an empty
// name renders NOTHING (no invented letter).
export function channelInitial(channel) {
  const src = typeof channel === 'string'
    ? channel
    : String(channel?.channelName || channel?.channelSlug || '');
  const t = src.trim();
  return t ? t.slice(0, 1).toUpperCase() : '';
}

// Hero pick (§4): the top Kick row by REAL viewerCount. Rows without a viewer
// count never out-rank rows with one; if none carry a count the first row is
// the hero (and the UI renders no viewer count — §1). Empty list → null.
export function pickTopKickChannel(channels = []) {
  const kick = (Array.isArray(channels) ? channels : []).filter((c) => c && c.source === 'kick');
  if (kick.length === 0) return null;
  let best = null;
  let bestViewers = -1;
  for (const c of kick) {
    const v = c.viewerCount == null ? -1 : Number(c.viewerCount);
    if (Number.isFinite(v) && v > bestViewers) {
      best = c;
      bestViewers = v;
    }
  }
  return best || kick[0];
}

// Honest ladder caption for the Kick grid (§1: stale/floor keep their labels,
// a stale grid is never presented as fresh). null = nothing extra to say.
export function ladderLabel(servedFrom) {
  if (servedFrom === 'stale') return 'Streams below are a recent snapshot — the live check just failed.';
  if (servedFrom === 'floor') return 'Streams below come from our fallback floor — the providers are not responding.';
  return null;
}

// ---------------------------------------------------------------------------
// s5 hover-preview eligibility — PURE so the "which tiles get a live preview"
// rule is provable without a DOM (web/src/lib/landing.test.js).
//
// A tile previews the REAL stream (muted autoplay iframe) only when the row is
// a provider whose embed is VERIFIED (Kick / YouTube — web/src/lib/embed.js)
// AND buildVideoEmbed returns a genuine iframe src for it. Floor (unverified
// HLS) and any row with no embeddable target get NOTHING — we never mount a
// player we can't stand behind, and we never fabricate a preview frame.
// Returns the exact embed src string, or '' when the tile must stay a
// placeholder gradient.
// ---------------------------------------------------------------------------
export function hoverPreviewSrc(channel) {
  if (!channel || !isEmbedVerified(channel.source)) return '';
  const embed = buildVideoEmbed(channel);
  return embed && embed.kind === 'iframe' && embed.verified ? embed.src : '';
}

// ---------------------------------------------------------------------------
// s7 hero prediction gate — PURE so the "only a REAL bet may sit on the hero"
// rule is provable without a DOM (web/src/lib/landing.test.js).
//
// The owner asked (read-back #3) for a simple YES/NO market ON the featured
// stream. Honesty invariant (Panta Door 1): we may only surface a market whose
// outcome is a real one — we NEVER auto-invent a question and pretend it will
// settle. So the hero carries a bet ONLY when a real room is genuinely bound to
// THIS exact live stream (room.kick_channel === the hero's Kick slug, both
// normalized) AND that room's hero market is OPEN (bettable now). No such room
// ⇒ the hero shows NO market (the panel simply omits it) — we never borrow an
// unrelated bet to fill the slot. A channel binds at most one room by design;
// if several ever match, the loudest (highest real volume) honest one leads.
// ---------------------------------------------------------------------------
export function heroMarketForStream(rooms, hero) {
  const slug = String(hero?.channelSlug || '').trim().toLowerCase();
  if (!slug) return null;
  const list = Array.isArray(rooms) ? rooms : [];
  let best = null;
  let bestVolume = -Infinity;
  for (const room of list) {
    const bound = String(room?.kick_channel || '').trim().toLowerCase();
    if (!bound || bound !== slug) continue;
    if (!room.heroMarket || room.heroMarket.status !== 'open') continue;
    const volume = Number(room.heroMarket.volume) || 0;
    if (volume > bestVolume) {
      best = room;
      bestVolume = volume;
    }
  }
  return best;
}
