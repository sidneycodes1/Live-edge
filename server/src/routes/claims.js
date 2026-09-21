import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import bs58 from 'bs58';

export function claimsRouter({ _db, panta }) {
  const r = Router();

  const schema = z.object({ marketId: z.string().uuid(), signature: z.string().min(5) });

  r.post('/win', validate(schema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      try { bs58.decode(req.body.signature); } catch { return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid signature' } }); }
      const { marketId, signature } = req.body;
      let result;
      if (panta._sim) result = await panta._sim.submitClaim({ marketId, signature, userId: req.user.id });
      else result = await panta.submitClaim({ marketId, wallet: req.user.wallet, signature, userId: req.user.id });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  r.post('/creator-fees', validate(schema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      try { bs58.decode(req.body.signature); } catch { return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid signature' } }); }
      const { marketId, signature } = req.body;
      let result;
      if (panta._sim) result = await panta._sim.submitCreatorFeeClaim({ marketId, signature, userId: req.user.id });
      else result = await panta.submitCreatorFeeClaim({ marketId, wallet: req.user.wallet, signature, userId: req.user.id });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // build endpoints for signing (optional)
  r.post('/win/build', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { marketId } = req.body;
      const result = panta._sim ? await panta._sim.buildClaim({ marketId }) : await panta.buildClaim({ marketId, wallet: req.user.wallet });
      res.json(result);
    } catch (e) { next(e); }
  });

  r.post('/creator-fees/build', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { marketId } = req.body;
      const result = panta._sim ? await panta._sim.buildCreatorFeeClaim({ marketId }) : await panta.buildCreatorFeeClaim({ marketId, wallet: req.user.wallet });
      res.json(result);
    } catch (e) { next(e); }
  });

  return r;
}
