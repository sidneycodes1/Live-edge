// Notification center (F-005). Persist a row; the client bell polls for new ones.
// Writing a notification must NEVER break the primary action it describes (a claim
// or faucet credit that already succeeded), so DB errors are caught and logged
// rather than propagated. Notification bodies are user-facing strings (not secrets).
export function createNotifier(db, hub) {
  return async function notify({ userId, kind, body }) {
    if (!userId) return null;
    try {
      const { rows } = await db.query(
        'insert into notifications(user_id, kind, body) values($1,$2,$3) returning id, created_at',
        [userId, kind, body],
      );
      const row = rows[0];
      if (hub) {
        try {
          hub.toUser?.(userId, 'notification', { id: row.id, kind, body, created_at: row.created_at });
        } catch {
          /* hub has no per-user channel yet; polling covers it */
        }
      }
      return row;
    } catch (e) {
      console.error('notify failed:', e.message);
      return null;
    }
  };
}
