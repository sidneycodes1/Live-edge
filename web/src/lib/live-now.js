// ---------------------------------------------------------------------------
// "Live now" composition helpers — pure + unit-testable (no React, no fetch).
//
// The landing "Live now" rail mixes TWO honest card kinds: playable live channels
// (real thumbnail + embed) and football score cards (data-only, no art). On each
// visit the CATEGORY PRIORITY rotates so the mix feels fresh without ever
// fabricating content. Rotation is derived from a seed computed ONCE per visit
// (Date.now()- or sessionStorage-based) and kept in component state, so re-renders
// within a visit never re-shuffle.
// ---------------------------------------------------------------------------
import { mapToDisplay } from './categories.js';
import { extractYouTubeVideoId } from './embed.js';

// Canonical priority buckets. Football leads the base rotation, then the curated
// live categories. Anything not listed sorts after these (stable).
export const PRIORITY_CATEGORIES = ['Football', 'News', 'Sports', 'Music', 'Ambience'];

// Pure: rotate PRIORITY_CATEGORIES left by `seed`. seed 0 → base order; 1 → News
// first; 2 → Sports first; … wrapping around. Non-finite/negative seeds normalize
// into range. Deterministic and total (always returns a full permutation).
export function pickPriorityOrder(seed) {
  const n = PRIORITY_CATEGORIES.length;
  const num = Number(seed);
  const k = Number.isFinite(num) ? ((Math.trunc(num) % n) + n) % n : 0;
  return [...PRIORITY_CATEGORIES.slice(k), ...PRIORITY_CATEGORIES.slice(0, k)];
}

// Map a card (playable LiveChannel or football match) to a priority bucket.
// Curated rows already carry clean categories (News/Sports/Music/Ambience);
// provider rows carry a game/category label we classify via the fixed taxonomy.
export function bucketOf(card) {
  if (!card) return 'Other';
  if (card.source === 'football-api') return 'Football';
  const raw = String(card.category || '').trim();
  const lower = raw.toLowerCase();
  if (['news', 'sports', 'music', 'ambience'].includes(lower)) return raw.charAt(0).toUpperCase() + raw.slice(1);
  if (lower.includes('news')) return 'News';
  if (lower.includes('ambien')) return 'Ambience';
  const disp = mapToDisplay(raw);
  if (disp === 'Football') return 'Football';
  if (disp === 'Sports') return 'Sports';
  if (disp === 'Music') return 'Music';
  return 'Other';
}

// Combine football + playable cards into ONE list ordered by the rotated category
// priority, stable within a bucket (input order preserved). Football cards come
// first in the input so, at equal rank, matches lead the grid.
export function buildLiveNowCards({ playable = [], football = [] } = {}, seed = 0) {
  const order = pickPriorityOrder(seed);
  const rank = (card) => {
    const i = order.indexOf(bucketOf(card));
    return i === -1 ? order.length : i;
  };
  return [...football, ...playable]
    .map((card, idx) => ({ card, idx }))
    .sort((a, b) => rank(a.card) - rank(b.card) || a.idx - b.idx)
    .map((x) => x.card);
}

// A REAL thumbnail for a market card, or null (→ the caller renders a text-first
// card, never a fabricated image). Prefers a genuine provider image, then a real
// YouTube thumbnail derived from the market's own video URL/id.
export function marketThumb(room) {
  const hero = room?.heroMarket || {};
  const real = hero.image_url || hero.thumbnailUrl || hero.thumbnail_url || room?.thumbnailUrl;
  if (real) return real;
  const vid = extractYouTubeVideoId({ watchUrl: room?.video_url || hero.video_url || '', id: '' });
  if (vid) return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  return null;
}
