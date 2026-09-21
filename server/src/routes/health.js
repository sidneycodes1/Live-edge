import { Router } from 'express';

export function healthRouter(db) {
  const r = Router();
  r.get('/health', (_req, res) => res.json('ok'));
  r.get('/ready', async (_req, res) => {
    try {
      await db.query('select 1 as ok');
      res.json({ db: true });
    } catch (e) {
      res.status(503).json({ db: false, error: e.message });
    }
  });
  return r;
}
