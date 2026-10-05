// ---------------------------------------------------------------------------
// Interest tailoring — PURE feed re-rank over REAL cards only.
// Contract: docs/PRIVY_AUTH_SPEC.md "Tailoring rule (honesty §4)" +
// docs/ONBOARDING_PLAN.md: applied AFTER mergePinnedFirst, PINS ALWAYS LEAD,
// then interest-matched REAL cards (category/source fields), then the rest
// untouched. NEVER fabricate a card to fill an interest — this function only
// re-orders the array it is given (partition + concat), so output length ===
// input length and every output item is an input item (no duplication).
// ---------------------------------------------------------------------------
import { bucketOf } from './live-now.js';

// The frozen vocabulary (spec "Interest vocabulary"): trading | sports | streams.
export const INTEREST_VALUES = ['trading', 'sports', 'streams'];

// Which REAL fields can satisfy an interest — nothing else is consulted:
//   trading → the card's category classifies into the News bucket
//             (curated news channels; "Trading & News" is the UI label).
//   sports  → Football/Sports buckets (real category or football-api source).
//   streams → any REAL broadcast row (a source that isn't the football data
//             feed — the same distinction Discover's isPlayable makes).
// An unknown/blank category simply matches nothing; we never invent a label.
export function matchesInterest(card, interest) {
  if (!card || typeof card !== 'object') return false;
  switch (interest) {
    case 'trading':
      return bucketOf(card) === 'News';
    case 'sports': {
      const b = bucketOf(card);
      return b === 'Football' || b === 'Sports';
    }
    case 'streams':
      return Boolean(card.source) && card.source !== 'football-api';
    default:
      return false;
  }
}

// Normalize caller-supplied interests to the unique, known subset.
export function sanitizeInterests(interests) {
  if (!Array.isArray(interests)) return [];
  return [...new Set(interests)].filter((i) => INTEREST_VALUES.includes(i));
}

// cards: the OUTPUT of mergePinnedFirst (pinned cards occupy the first
// `leadCount` slots). leadCount defaults to "trust the caller" = 0 pinned;
// Discover passes its real pin count so pins can never be re-ranked below.
export function tailorByInterests(cards = [], interests = [], { leadCount = 0 } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const wanted = sanitizeInterests(interests);
  if (wanted.length === 0) return [...list]; // empty interests ⇒ current order preserved

  const lead = Math.min(Math.max(Number(leadCount) || 0, 0), list.length);
  const pinned = list.slice(0, lead);
  const rest = list.slice(lead);
  const matched = [];
  const unmatched = [];
  for (const card of rest) {
    (wanted.some((i) => matchesInterest(card, i)) ? matched : unmatched).push(card);
  }
  return [...pinned, ...matched, ...unmatched];
}
