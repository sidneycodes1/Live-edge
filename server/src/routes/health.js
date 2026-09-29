import { Router } from 'express';

export function healthRouter(db) {
  const r = Router();
  r.get('/health', (_req, res) => res.json('ok'));
  // F-011: the directive's route map expects /api/health with a real status
  // body. Keep the bare /health (returns "ok") for the existing Render probe and
  // add the documented /api/health alias: richer payload + 503 when DB is down.
  r.get('/api/health', async (_req, res) => {
    let dbOk = false;
    try {
      await db.query('select 1 as ok');
      dbOk = true;
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', uptime: Math.round(process.uptime()), db: dbOk });
  });
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
