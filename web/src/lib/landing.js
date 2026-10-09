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

// Group a normalized LiveChannel list into landing buckets. ONLY Kick rows join
// the bucket sections (§4 — YouTube/floor rows are not landing sources). The
// `bucket` field comes from the server (§2a); a row without one (or with an
// unknown value) is tolerant-routed to 'other' — same default normalizeChannel
// applies — and 'other' has no landing section, so it simply isn't shown.
export function groupKickByBucket(channels = []) {
  const out = { sports: [], news: [], irl: [], games: [], other: [] };
  for (const c of Array.isArray(channels) ? channels : []) {
    if (!c || c.source !== 'kick') continue;
    const key = KICK_BUCKET_KEYS.includes(c.bucket) ? c.bucket : 'other';
    out[key].push(c);
  }
  return out;
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
// be shown as empty — never backfilled from another provider or bucket).
export function emptyStateLabel(sectionKey) {
  const s = LANDING_SECTIONS.find((x) => x.key === sectionKey);
  const title = s ? s.title : 'this';
  return `No live ${title} streams on Kick right now.`;
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
