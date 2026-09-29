// Tiny app-level event bus. A toast already fires on every balance/notification
// changing action (trade, claim, fee, faucet, create, sign-in); emitting here lets
// the notification bell and the header balance both refetch without every component
// having to wire its own refresh call.
const listeners = new Set();

export function onDataRefresh(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitDataRefresh() {
  for (const l of [...listeners]) {
    try { l(); } catch { /* a listener must never break the emitter */ }
  }
}
