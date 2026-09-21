// Simple SSE hub
export function createHub() {
  /** @type {Map<string, Set<any>>} */
  const rooms = new Map();
  let heartbeatTimer = null;

  function getRoom(roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    return rooms.get(roomId);
  }

  function add(roomId, res) {
    const set = getRoom(roomId);
    set.add(res);
    // cleanup on close
    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) rooms.delete(roomId);
    });
  }

  function broadcast(roomId, event, data) {
    const set = rooms.get(roomId);
    if (!set) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...set]) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }

  function count(roomId) {
    return rooms.get(roomId)?.size ?? 0;
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      for (const [roomId, set] of rooms) {
        for (const res of [...set]) {
          try {
            res.write(`: heartbeat\n\n`);
          } catch {
            set.delete(res);
          }
        }
        if (set.size === 0) rooms.delete(roomId);
      }
    }, 15000);
    if (heartbeatTimer.unref) heartbeatTimer.unref();
  }

  function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function size() {
    let total = 0;
    for (const s of rooms.values()) total += s.size;
    return total;
  }

  startHeartbeat();
  return { add, broadcast, count, size, stop, _rooms: rooms };
}
