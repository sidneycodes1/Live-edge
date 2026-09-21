import { Router } from 'express';

export function streamRouter({ hub }) {
  const r = Router();

  r.get('/:roomId', async (req, res) => {
    const roomId = req.params.roomId;
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
      // hub will cleanup via res close listener; broadcast new count
      setTimeout(() => {
        hub.broadcast(roomId, 'viewers', { count: hub.count(roomId) });
      }, 100);
    });
  });

  return r;
}
