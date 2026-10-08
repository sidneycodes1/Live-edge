// ---------------------------------------------------------------------------
// ChatComposer pure logic (Agent A lane, docs/BUILD_CONTRACT-browse-ui-chat.md).
//
// Kept as side-effect-free functions (no react, no fetch, no api import) so the
// composer's decisions are unit-testable hermetically -- this repo's Vitest suite
// is pure-logic (no jsdom / DOM rendering). postChat takes an injected api object
// so the "posts via api.chat" contract is asserted without a network or a DOM.
//
// Honesty rules encoded here (contract sections 0/1, HARD RULES):
//   * a guest never gets a dead Send button -- they get a real sign-in affordance;
//   * a signed-in user on a room-less watch page is told the truth (section 5a)
//     rather than shown a button that can't post (we never invent a roomId);
//   * the server caps a chat body at 1..280, so mirror that here before sending.
// ---------------------------------------------------------------------------

export const CHAT_MAX = 280;

// Which affordance the composer renders. Order matters for honesty: a room-less
// stream can't be posted to by ANYONE, so say that before offering sign-in.
export function composerMode({ user, roomId }) {
  if (!roomId) return 'no-room'; // section 5a: watch pages have no room row
  if (!user) return 'signin'; // guest -> real sign-in affordance, never a dead button
  return 'ready';
}

// Validate + normalise a draft body against the server schema (min 1, max 280).
export function validateChatBody(body) {
  const trimmed = String(body == null ? '' : body).trim();
  if (!trimmed) return { ok: false, error: 'Write a message first' };
  if (trimmed.length > CHAT_MAX) return { ok: false, error: `Message too long (max ${CHAT_MAX} characters)` };
  return { ok: true, body: trimmed };
}

// Post through the EXISTING api.chat(roomId, body) (web/src/lib/api.js:103).
// On success returns a feed-shaped message for the optimistic append; the shape
// matches ChatFeed's items ({ kind, name, body }) so the pending row is
// interchangeable with history/SSE rows. api is injected for testability.
export async function postChat({ api, roomId, body }) {
  const v = validateChatBody(body);
  if (!v.ok) return { ok: false, error: v.error };
  const row = await api.chat(roomId, v.body);
  // POST /api/chat returns the inserted chat_messages row (returning *):
  // { room_id, user_id, kind:'chat', body, created_at, is_seed, display_name }.
  return {
    ok: true,
    message: {
      kind: row?.kind || 'chat',
      name: row?.display_name || null,
      body: row?.body || v.body,
    },
  };
}

// Merge optimistically-appended local messages over the derived feed. Once the
// server echoes the same text back over SSE (the poster is broadcast to too),
// the pending copy is dropped so a post never shows twice.
export function mergeOptimistic(items, pending = []) {
  const extras = pending.filter((p) => !items.some((i) => i.body === p.body));
  return [...items, ...extras];
}