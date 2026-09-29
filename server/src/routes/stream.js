import { Router } from 'express';

export function streamRouter({ hub }) {
  const r = Router();
  // F-018: SSE connections are long-lived and hold a socket + hub entry each.
  // Without a per-client ceiling one host can exhaust sockets (resource
  // exhaustion). Cap concurrent streams per IP; `app.set('trust proxy',1)` makes
  // req.ip the real client behind the single reverse proxy.
  const MAX_PER_IP = 10;
  const liveByIp = new Map();

  r.get('/:roomId', async (req, res) => {
    const roomId = req.params.roomId;
    const ip = req.ip || 'unknown';
    const cur = liveByIp.get(ip) || 0;
    if (cur >= MAX_PER_IP) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many concurrent stream connections' } });
      return;
    }
    liveByIp.set(ip, cur + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (liveByIp.get(ip) || 1) - 1;
      if (n <= 0) liveByIp.delete(ip);
      else liveByIp.set(ip, n);
    };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    // initial hello
    const viewers = hub.count(roomId) + 1;
    res.write(`event: hello\ndata: ${JSON.stringify({ viewers })}\n\n`);
    res.write(`event: viewers\ndata: ${JSON.stringify({ count: viewers })}\n\n`);
    hub.add(roomId, res);
    // update viewers for others
    hub.broadcast(roomId, 'viewers', { count: hub.count(roomId) });
    // keep alive handled by hub heartbeat; also send comment
    req.on('close', () => {
      release();
      // hub will cleanup via res close listener; broadcast new count
      setTimeout(() => {
        hub.broadcast(roomId, 'viewers', { count: hub.count(roomId) });
      }, 100);
    });
  });

  return r;
}

