import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

export function notificationsRouter({ db }) {
  const r = Router();

  r.get('/', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      const wantUnread = req.query.unread === '1' || req.query.unread === 'true';
      const where = wantUnread ? 'user_id=$1 and read_at is null' : 'user_id=$1';
      const { rows } = await db.query(`select id, kind, body, read_at, created_at from notifications where ${where} order by created_at desc, id desc limit 100`, [userId]);
      const { rows: cRows } = await db.query('select count(*)::int as c from notifications where user_id=$1 and read_at is null', [userId]);
      res.json({ items: rows, unreadCount: cRows[0].c });
    } catch (e) {
      next(e);
    }
  });

  const readSchema = z.object({ id: z.string().uuid().optional(), all: z.boolean().optional(), ids: z.array(z.string().uuid()).optional() });

  async function unreadCount(userId) {
    const { rows } = await db.query('select count(*)::int as c from notifications where user_id=$1 and read_at is null', [userId]);
    return rows[0].c;
  }

  r.post('/read', validate(readSchema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      const { id, all, ids } = req.body;
      // Count before/after rather than trusting UPDATE rowCount: the PGlite wrapper
      // does not report affected-row counts for UPDATE the way node-pg does, so a
      // rowCount-based number would be wrong there. This is engine-independent.
      const before = await unreadCount(userId);
      if (id) {
        await db.query('update notifications set read_at=now() where user_id=$1 and id=$2 and read_at is null', [userId, id]);
      } else if (Array.isArray(ids) && ids.length) {
        for (const nid of ids) {
          await db.query('update notifications set read_at=now() where user_id=$1 and id=$2 and read_at is null', [userId, nid]);
        }
      } else if (all || (!id && !ids)) {
        await db.query('update notifications set read_at=now() where user_id=$1 and read_at is null', [userId]);
      }
      const after = await unreadCount(userId);
      res.json({ updated: Math.max(0, before - after), unreadCount: after });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
