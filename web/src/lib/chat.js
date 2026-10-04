// Chat feed merge (pure, tested in chat.test.js).
// History rows arrive from GET /api/rooms/:id as { kind, body, user: { display_name } }.
// Live SSE events arrive as { type: 'chat'|'trade', data } where chat data carries
// { kind, name, body } — kind 'ai' marks a labeled simulated spectator (services/aiChat.js
// honesty contract), so the badge must survive the SSE path too, not just history.

export function deriveChatItems(messages = [], sseEvents = []) {
  const history = messages.map((m) => ({
    kind: m.kind || 'chat',
    name: m.user?.display_name || null,
    body: m.body,
  }));
  const live = sseEvents
    .filter((e) => e.type === 'chat' || e.type === 'trade')
    .map((e) => ({
      kind: e.data.kind || e.type,
      name: e.data.name || null,
      body: e.data.body || `${e.data.name} backed ${e.data.side} for $${e.data.amount}`,
    }));
  return [...history, ...live];
}
