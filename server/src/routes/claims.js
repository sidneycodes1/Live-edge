import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import bs58 from 'bs58';
import { assertTermsAccepted } from '../lib/termsGate.js';

export function claimsRouter({ db, panta, notify }) {
  const r = Router();

  const schema = z.object({ marketId: z.string().uuid(), signature: z.string().min(5) });

  r.post('/win', validate(schema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      try { bs58.decode(req.body.signature); } catch { return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid signature' } }); }
      // Money only moves on the committed claim — enforce the Terms gate here.
      await assertTermsAccepted(db, req.user.id);
      const { marketId, signature } = req.body;
      let result;
      if (panta._sim) result = await panta._sim.submitClaim({ marketId, signature, userId: req.user.id });
      else result = await panta.submitClaim({ marketId, wallet: req.user.wallet, signature, userId: req.user.id });
      if (notify && result && !result.idempotent) {
        await notify({ userId: req.user.id, kind: 'claim_completed', body: `Claimed! +$${Number(result.amount).toFixed(2)} added to your balance` });
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  r.post('/creator-fees', validate(schema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      try { bs58.decode(req.body.signature); } catch { return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid signature' } }); }
      // Money only moves on the committed claim — enforce the Terms gate here.
      await assertTermsAccepted(db, req.user.id);
      const { marketId, signature } = req.body;
      let result;
      if (panta._sim) result = await panta._sim.submitCreatorFeeClaim({ marketId, signature, userId: req.user.id });
      else result = await panta.submitCreatorFeeClaim({ marketId, wallet: req.user.wallet, signature, userId: req.user.id });
      if (notify && result && !result.idempotent) {
        await notify({ userId: req.user.id, kind: 'fee_claimed', body: `Creator fees claimed: +$${Number(result.amount).toFixed(2)}` });
      }
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
      const result = panta._sim ? await panta._sim.buildClaim({ marketId, wallet: req.user.wallet, userId: req.user.id }) : await panta.buildClaim({ marketId, wallet: req.user.wallet, userId: req.user.id });
      res.json(result);
    } catch (e) { next(e); }
  });

  r.post('/creator-fees/build', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { marketId } = req.body;
      const result = panta._sim ? await panta._sim.buildCreatorFeeClaim({ marketId, wallet: req.user.wallet, userId: req.user.id }) : await panta.buildCreatorFeeClaim({ marketId, wallet: req.user.wallet, userId: req.user.id });
      res.json(result);
    } catch (e) { next(e); }
  });

  return r;
}
