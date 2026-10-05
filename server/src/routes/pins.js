import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

// ---------------------------------------------------------------------------
// Live pins (auth-only surface, mounted at /api/pins).
//
// A pin is "watch this stream / play games with them" — the user's own shelf
// that leads the "Live now" grid. Rules:
//   • MAX 4 pins per user (409 PIN_LIMIT beyond that — the cap is a product
//     decision, enforced here so every client respects it).
//   • Re-pinning an existing stream UPSERTS the snapshot (title/payload may
//     have refreshed) and never consumes a second slot.
//   • The payload is a snapshot of the real card fields at pin time, so the
//     pinned card still renders after the stream rotates out of /api/live.
//     We store what the provider gave us — nothing is invented (§4 honesty).
// ---------------------------------------------------------------------------

export const MAX_PINS = 4;

const pinSchema = z.object({
  streamId: z.string().min(3).max(160),
  source: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  payload: z.record(z.any()).optional(),
});

export function pinsRouter({ db }) {
  const r = Router();

  async function pinCount(userId) {
    const { rows } = await db.query('select count(*)::int as c from live_pins where user_id=$1', [userId]);
    return rows[0].c;
  }

  async function listPins(userId) {
    const { rows } = await db.query(
      `select stream_id, source, title, payload, created_at from live_pins
        where user_id=$1 order by created_at asc, stream_id asc`,
      [userId],
    );
    return rows;
  }

  r.get('/', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const items = await listPins(req.user.id);
      res.json({ items, count: items.length, max: MAX_PINS });
    } catch (e) {
      next(e);
    }
  });

  r.post('/', validate(pinSchema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { streamId, source, title, payload } = req.body;
      const existing = await db.query('select 1 from live_pins where user_id=$1 and stream_id=$2', [req.user.id, streamId]);
      if (existing.rows.length === 0 && (await pinCount(req.user.id)) >= MAX_PINS) {
        return res.status(409).json({ error: { code: 'PIN_LIMIT', message: `You can pin at most ${MAX_PINS} live streams` } });
      }
      await db.query(
        `insert into live_pins(user_id, stream_id, source, title, payload)
         values($1,$2,$3,$4,$5::jsonb)
         on conflict (user_id, stream_id) do update set source=$3, title=$4, payload=$5::jsonb`,
        [req.user.id, streamId, source, title, JSON.stringify(payload || {})],
      );
      res.status(201).json({ ok: true, items: await listPins(req.user.id), count: await pinCount(req.user.id), max: MAX_PINS });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/:streamId', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const streamId = decodeURIComponent(req.params.streamId);
      await db.query('delete from live_pins where user_id=$1 and stream_id=$2', [req.user.id, streamId]);
      res.json({ ok: true, items: await listPins(req.user.id), count: await pinCount(req.user.id), max: MAX_PINS });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
