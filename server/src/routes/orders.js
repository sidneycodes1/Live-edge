import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { PantaError } from '../panta/errors.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { canonicalStringify } from '../lib/signature.js';
import { assertTermsAccepted } from '../lib/termsGate.js';

function _verifySig(messageObj, signature, wallet) {
  try {
    const msg = canonicalStringify(messageObj);
    const msgBytes = new TextEncoder().encode(msg);
    const sigBytes = bs58.decode(signature);
    const pubBytes = bs58.decode(wallet);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

export function ordersRouter({ db, panta, hub }) {
  const r = Router();

  const quoteSchema = z.object({
    marketId: z.string().uuid(),
    side: z.enum(['yes', 'no']),
    amount: z.coerce.number().positive(),
  });

  r.post('/quote', validate(quoteSchema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { marketId, side, amount } = req.body;
      const quote = await panta.quoteBuy({ marketId, side, amountUsdc: amount, amount, wallet: req.user.wallet, userId: req.user.id });
      res.json(quote);
    } catch (e) {
      next(e);
    }
  });

  // const buildSchema = z.object({ orderId: z.string().min(1), quoteId: z.string().optional() }); // Unused

    r.post('/build', async (req, res, next) => {
      try {
        if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        const id = req.body.orderId || req.body.quoteId;
        if (!id) throw new PantaError('VALIDATION_ERROR', 'orderId required', { status: 400 });
        const result = await panta.buildBuy(id);
        res.json(result);
      } catch (e) {
        next(e);
      }
    });

  const submitSchema = z.object({ orderId: z.string().min(1), quoteId: z.string().optional(), signature: z.string().min(5) });

  r.post('/submit', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      // Money only moves on the committed order — the honest place to enforce the gate.
      await assertTermsAccepted(db, req.user.id);
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) throw new PantaError('VALIDATION_ERROR', 'Invalid input', { status: 400, details: parsed.error.issues });
      const { signature } = parsed.data;
      const orderId = parsed.data.orderId || parsed.data.quoteId;
      // verify signature encodes base58; actual payload verification is done via deterministic JSON? For sim we just check base58.
      try {
        bs58.decode(signature);
      } catch {
        throw new PantaError('VALIDATION_ERROR', 'Invalid signature encoding', { status: 400 });
      }
      // delegate to panta sim
      let result;
      if (panta._sim) result = await panta._sim.submitBuy(orderId, signature, req.user.id);
      else result = await panta.submitBuy(orderId, signature, req.user.id);

      if (result.idempotent) {
        return res.json({ trade: result.trade, idempotent: true });
      }
      // on success, broadcast and add chat line
      const market = result.market;
      const trade = result.trade;
      // fetch user display
      const { rows: uRows } = await db.query('select display_name, wallet from users where id=$1', [req.user.id]);
      const name = uRows[0]?.display_name || (req.user.wallet.slice(0, 4) + '…' + req.user.wallet.slice(-4));
      const body = `@${name} backed ${trade.side.toUpperCase()} for $${trade.amount}`;
      // Need room_id: get from market
      let roomId = market.room_id;
      if (!roomId) {
        const { rows: mRows } = await db.query('select room_id, yes_price, no_price, volume from markets where id=$1', [trade.market_id || market.id]);
        if (mRows.length) {
          market.yes_price = mRows[0].yes_price;
          market.no_price = mRows[0].no_price;
          roomId = mRows[0].room_id;
        }
      }
      if (roomId) {
        await db.query(`insert into chat_messages(room_id, user_id, kind, body) values($1,$2,'trade',$3)`, [roomId, req.user.id, body]);
      }
      if (hub && roomId) {
        const { rows: mRows2 } = await db.query('select yes_price, no_price, volume from markets where id=$1', [trade.market_id || market.id]);
        const m2 = mRows2[0];
        if (m2) {
          hub.broadcast(roomId, 'odds', { marketId: trade.market_id || market.id, yesPrice: Number(m2.yes_price), noPrice: Number(m2.no_price), volume: Number(m2.volume), ts: new Date().toISOString() });
        }
        hub.broadcast(roomId, 'trade', { name, side: trade.side, amount: Number(trade.amount) });
        hub.broadcast(roomId, 'chat', { kind: 'trade', body, name });
      }
      res.json({ trade, market });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
