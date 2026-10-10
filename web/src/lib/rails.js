import { bucketOf } from './live-now.js';
import { sanitizeInterests } from './tailoring.js';

// ---------------------------------------------------------------------------
// Personalized bet rails (Phase 2, s6) — PURE selection over REAL rooms only.
// The owner's rule: ~7 bets, 4 drawn from the user's interest selection and 3
// "mixed" for discovery, NO repeats and NEVER two bets on the SAME live stream.
//
// Honesty (spec §1/§4): this only FILTERS and RE-ORDERS real rooms — it never
// fabricates a market, never duplicates one, and never pads the rail. With
// fewer real bets than the targets it honestly returns fewer (the rail simply
// holds fewer cards). A logged-out user (no interests) gets the diverse
// "mixed" selection, still one-per-stream.
// ---------------------------------------------------------------------------

// Rail shape: 4 interest slots + 3 discovery slots (ceilings, not guarantees).
export const MATCHED_TARGET = 4;
export const MIXED_TARGET = 3;
export const RAIL_TARGET = MATCHED_TARGET + MIXED_TARGET;

// A room is rail-eligible only when it carries an OPEN bet (nothing closed /
// resolved / absent can be bet on, so it must not occupy a rail slot).
function isEligible(room) {
  return Boolean(room && room.heroMarket && room.heroMarket.status === 'open');
}

// The LIVE STREAM a bet rides. A room bound to a real Kick channel dedupes by
// that channel (two bets on one stream collapse to one); a channel-less / demo
// room dedupes by its own id. Returns '' only for a room with neither — which
// can never key a stream, so it is dropped.
export function streamKeyOf(room) {
  const ch = String(room?.kick_channel || '').trim().toLowerCase();
  if (ch) return `kick:${ch}`;
  const id = String(room?.id || '').trim();
  return id ? `room:${id}` : '';
}

// Volume as social-proof rank (real number only; missing → 0).
function volumeOf(room) {
  return Number(room?.heroMarket?.volume) || 0;
}

// The room's bet category, classified into the SAME display bucket the landing
// uses — read off real fields, never invented.
function roomBucket(room) {
  const cat = room?.heroMarket?.category || room?.category;
  return bucketOf({ category: cat });
}

// Which interest (if any) a room's bet satisfies — the frozen three-vocabulary
// rule (trading | sports | streams) applied to real room/market fields:
//   sports  → the bet's category classifies into the Sports bucket
//   trading → the News bucket (financial / news markets)
//   streams → the bet rides a REAL bound live stream (a kick channel)
function roomMatchesInterest(room, interest) {
  switch (interest) {
    case 'sports':
      return roomBucket(room) === 'Sports';
    case 'trading':
      return roomBucket(room) === 'News';
    case 'streams':
      return Boolean(String(room?.kick_channel || '').trim());
    default:
      return false;
  }
}

// Collapse to ONE representative bet per live stream: the highest-volume open
// bet wins; ties break on the (stable) room id so the result is deterministic.
function onePerStream(rooms) {
  const best = new Map();
  for (const room of rooms) {
    const key = streamKeyOf(room);
    if (!key) continue;
    const cur = best.get(key);
    if (
      !cur
      || volumeOf(room) > volumeOf(cur)
      || (volumeOf(room) === volumeOf(cur) && String(room.id) < String(cur.id))
    ) {
      best.set(key, room);
    }
  }
  return [...best.values()].sort(
    (a, b) => volumeOf(b) - volumeOf(a) || String(a.id).localeCompare(String(b.id)),
  );
}

// Order the "mixed" remainder so discovery spans TOPICS: round-robin across the
// category buckets (each bucket internally still volume-desc from onePerStream),
// so three mixed picks rarely come from one subject. Pure — no additions.
function interleaveByBucket(rooms) {
  const groups = new Map();
  for (const room of rooms) {
    const b = roomBucket(room) || 'Other';
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(room);
  }
  const lists = [...groups.values()];
  const out = [];
  let added = true;
  let i = 0;
  while (added) {
    added = false;
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]);
        added = true;
      }
    }
    i += 1;
  }
  return out;
}

// Build the personalized bets rail: up to MATCHED_TARGET interest picks first,
// then up to MIXED_TARGET mixed picks — one per distinct live stream, no
// repeats, never padded past the real supply.
export function buildPersonalizedBets(
  rooms = [],
  interests = [],
  { matchedTarget = MATCHED_TARGET, mixedTarget = MIXED_TARGET } = {},
) {
  const list = Array.isArray(rooms) ? rooms : [];
  const wanted = sanitizeInterests(interests);
  const unique = onePerStream(list.filter(isEligible));

  const matched = [];
  const rest = [];
  for (const room of unique) {
    const hit = wanted.length > 0 && wanted.some((i) => roomMatchesInterest(room, i));
    (hit ? matched : rest).push(room);
  }

  const picks = matched.slice(0, matchedTarget);
  const taken = new Set(picks.map((r) => r.id));
  for (const room of interleaveByBucket(rest)) {
    if (picks.length >= matchedTarget + mixedTarget) break;
    if (taken.has(room.id)) continue;
    picks.push(room);
    taken.add(room.id);
  }
  return picks.slice(0, matchedTarget + mixedTarget);
}
