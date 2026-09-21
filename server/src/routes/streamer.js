import { Router } from 'express';

export function streamerRouter({ _db, panta }) {
  const r = Router();
  r.get('/metrics', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const metrics = panta._sim ? await panta._sim.getMetrics({ userId: req.user.id }) : await panta.getMetrics({ userId: req.user.id });
      res.json(metrics);
    } catch (e) {
      next(e);
    }
  });
  return r;
}
