// Tiny app-level event bus so a toast (which already fires on every
// notification-worthy action) also nudges the notification bell to refetch,
// without wiring a refresh call into every component.
const listeners = new Set();

export function onNotificationsRefresh(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitNotificationsRefresh() {
  for (const l of [...listeners]) {
    try { l(); } catch { /* a listener must never break the emitter */ }
  }
}
