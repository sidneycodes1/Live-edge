// ---------------------------------------------------------------------------
// Live pins — pure helpers (no React, no fetch; unit-tested in pins.test.js).
//
// A pin is the user saying "I'm watching / playing with this stream" — it must
// lead the "Live now" grid. The server stores a SNAPSHOT of the real card at
// pin time (payload), so a pinned stream still renders after it rotates out
// of the live grid; when the fresh grid DOES contain it, we prefer the fresh
// card (live viewer counts) at the pinned position. Nothing is invented:
// a pin whose snapshot lacks a field renders without that field (§4 honesty).
// ---------------------------------------------------------------------------

export const MAX_PINS = 4; // product cap — server enforces the same (409 PIN_LIMIT)

// Card → POST /api/pins body. Returns null for cards without an id (never pin ghosts).
export function pinBodyFromCard(card) {
  if (!card || card.id == null) return null;
  return {
    streamId: String(card.id),
    source: String(card.source || 'live'),
    title: String(card.title || card.channelName || 'Live stream').slice(0, 200),
    payload: card,
  };
}

// Stored pin → renderable card (the snapshot, with authoritative id/source/title).
export function pinToCard(pin) {
  const p = pin?.payload || {};
  return { ...p, id: pin.stream_id, source: pin.source || p.source || 'live', title: pin.title || p.title || 'Live stream' };
}

// Pinned cards FIRST (in pin order), then the rest of the grid untouched.
// A grid card that is pinned moves to its pinned slot (fresh data wins);
// a pin no longer in the grid renders from its snapshot. Never duplicates.
export function mergePinnedFirst(cards = [], pins = []) {
  const byId = new Map(cards.map((c) => [String(c.id), c]));
  const used = new Set();
  const out = [];
  for (const pin of pins.slice(0, MAX_PINS)) {
    const id = String(pin.stream_id);
    const fresh = byId.get(id);
    if (fresh) {
      out.push(fresh);
      used.add(id);
    } else {
      out.push(pinToCard(pin));
    }
  }
  for (const c of cards) if (!used.has(String(c.id))) out.push(c);
  return out;
}
