import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { sanitizeText } from '../services/sanitize.js';

export function chatRouter({ db, hub }) {
  const r = Router();
  const schema = z.object({ roomId: z.string().uuid(), body: z.string().min(1).max(280) });

  r.post('/', validate(schema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const body = sanitizeText(req.body.body);
      if (!body) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Empty message' } });
      const { rows: roomRows } = await db.query('select id from rooms where id=$1', [req.body.roomId]);
      if (roomRows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Room not found' } });
      const { rows } = await db.query(`insert into chat_messages(room_id, user_id, kind, body) values($1,$2,'chat',$3) returning *`, [req.body.roomId, req.user.id, body]);
      const msg = rows[0];
      const { rows: uRows } = await db.query('select display_name, wallet from users where id=$1', [req.user.id]);
      const name = uRows[0]?.display_name || req.user.wallet.slice(0, 4) + '…' + req.user.wallet.slice(-4);
      if (hub) hub.broadcast(req.body.roomId, 'chat', { id: msg.id, kind: 'chat', body, name, ts: msg.created_at });
      res.status(201).json(msg);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
