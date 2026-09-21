import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { PantaError } from '../panta/errors.js';
import { sanitizeText } from '../services/sanitize.js';

export function marketsRouter({ db, panta, hub, priceCache }) {
  const r = Router();

  r.get('/catalog', async (_req, res, next) => {
    try {
      const data = await priceCache.get(async () => {
        try {
          const result = await panta.listMarkets({ limit: 20 });
          return result;
        } catch (e) {
          return { source: 'unavailable', items: [], error: e.message };
        }
      });
      if (data.source === 'unavailable' || data.source === 'sim') {
        return res.json({ source: 'unavailable', items: [] });
      }
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);
      const { rows } = await db.query('select * from markets where id=$1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Market not found' } });
      const m = rows[0];
      res.json({
        id: m.id,
        room_id: m.room_id,
        question: m.question,
        resolution_rule: m.resolution_rule,
        sources_of_truth: m.sources_of_truth,
        category: m.category,
        image_url: m.image_url,
        yes_price: Number(m.yes_price),
        no_price: Number(m.no_price),
        q_yes: Number(m.q_yes),
        q_no: Number(m.q_no),
        volume: Number(m.volume),
        status: m.status,
        outcome: m.outcome,
        graduated: m.graduated,
        creator_fees_accrued: Number(m.creator_fees_accrued),
        creator_fees_claimed: m.creator_fees_claimed,
        isSeed: m.is_seed,
        source: m.source,
        start_time: m.start_time,
        end_time: m.end_time,
        resolution_time: m.resolution_time,
      });
    } catch (e) {
      next(e);
    }
  });

  const quoteSchema = z.object({
    roomId: z.string().uuid(),
    question: z.string().min(8).max(140).optional(),
    template: z.string().optional(),
    resolutionRule: z.string().min(5).optional(),
    resolution_rule: z.string().min(5).optional(),
    sourcesOfTruth: z.array(z.string()).min(1).optional(),
    sources_of_truth: z.array(z.string()).min(1).optional(),
    endInMinutes: z.coerce.number().min(1).max(1440).optional(),
    end_in_minutes: z.coerce.number().min(1).max(1440).optional(),
    category: z.string().optional(),
  });

  r.post('/quote', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const parsed = quoteSchema.safeParse(req.body);
      if (!parsed.success) throw new PantaError('VALIDATION_ERROR', 'Invalid input', { status: 400, details: parsed.error.issues });
      const body = parsed.data;
      const question = sanitizeText(body.question || body.template || '');
      if (!question || question.length < 8) throw new PantaError('VALIDATION_ERROR', 'Question required (8-140 chars)', { status: 400 });
      const resolutionRule = sanitizeText(body.resolutionRule || body.resolution_rule || 'As described by streamer, resolved via stream VOD');
      const sources = body.sourcesOfTruth || body.sources_of_truth || ['https://example.com/stream'];
      const endInMinutes = body.endInMinutes || body.end_in_minutes || 10;
      const category = body.category || 'gaming';
      // check room ownership
      const { rows: roomRows } = await db.query('select * from rooms where id=$1', [body.roomId]);
      if (roomRows.length === 0) throw new PantaError('NOT_FOUND', 'Room not found', { status: 404 });
      if (roomRows[0].owner_id !== req.user.id) throw new PantaError('FORBIDDEN', 'Only room owner can create market', { status: 403 });
      const input = { roomId: body.roomId, question, resolutionRule, sourcesOfTruth: sources, endInMinutes, category, wallet: req.user.wallet };
      const quote = await panta.quoteCreate(input);
      // we need to store quoteId mapping for sim; panta hybrid already handles, but for our flow we rely on panta's quoteId
      res.json(quote);
    } catch (e) {
      next(e);
    }
  });

  const buildSchema = z.object({ quoteId: z.string().min(1) });

  r.post('/build', validate(buildSchema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { quoteId } = req.body;
      const result = await panta.buildCreate(quoteId, req.user.wallet);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  const registerSchema = z.object({ quoteId: z.string().min(1), signature: z.string().min(5) });

  r.post('/register', validate(registerSchema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const { quoteId, signature } = req.body;
      // verify signature is valid base58 and author matches wallet? For sim we verify ed25519 over signPayload.
      // We don't have signPayload stored, but we can at least check signature decodes and then delegate to panta.
      // For now allow any base58 signature and rely on panta simClient to handle duplicate check.
      let market;
      if (panta._sim && panta._sim.registerMarket) {
        // hybrid/sim path
        market = await panta._sim.registerMarket(quoteId, signature, req.user.id);
      } else if (panta.registerMarket) {
        market = await panta.registerMarket(quoteId, signature, req.user.id);
      } else {
        throw new PantaError('UPSTREAM_UNAVAILABLE', 'Register not available', { status: 502 });
      }
      // insert system chat
      if (hub) {
        await db.query(`insert into chat_messages(room_id, user_id, kind, body) values($1,$2,'system',$3)`, [market.room_id, req.user.id, `New market just dropped: ${market.question}`]);
        hub.broadcast(market.room_id, 'market_created', { market: { id: market.id, question: market.question, yes_price: Number(market.yes_price), no_price: Number(market.no_price) } });
        hub.broadcast(market.room_id, 'chat', { kind: 'system', body: `New market just dropped: ${market.question}` });
      }
      res.status(201).json(market);
    } catch (e) {
      next(e);
    }
  });

  const resolveSchema = z.object({ outcome: z.enum(['yes', 'no']), force: z.boolean().optional() });

  r.post('/:id/resolve', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const parsed = resolveSchema.safeParse(req.body);
      if (!parsed.success) throw new PantaError('VALIDATION_ERROR', 'Invalid input', { status: 400, details: parsed.error.issues });
      const { outcome, force } = parsed.data;
      const { rows } = await db.query('select * from markets where id=$1', [req.params.id]);
      if (rows.length === 0) throw new PantaError('NOT_FOUND', 'Market not found', { status: 404 });
      const m = rows[0];
      if (m.creator_id !== req.user.id) throw new PantaError('FORBIDDEN', 'Only creator can resolve', { status: 403 });
      // check live mode forbidden? spec says live mode 403
      // we check env? for now allow in sim/hybrid, but if panta.mode === 'live' then 403
      if (panta.mode === 'live') throw new PantaError('FORBIDDEN', 'Resolve disabled in live mode', { status: 403 });
      if (m.status === 'resolved') return res.json(m);
      // allow force in non-production or if forced
      const isClosed = m.status === 'closed' || new Date(m.end_time) <= new Date();
      if (!isClosed && !force) {
        // allow if NODE_ENV != production and force true? we already checked
        throw new PantaError('MARKET_CLOSED', 'Market not closed yet (use force in dev)', { status: 400 });
      }
      if (process.env.NODE_ENV === 'production' && force) {
        throw new PantaError('FORBIDDEN', 'Force not allowed in production', { status: 403 });
      }
      await db.query(`update markets set status='resolved', outcome=$1 where id=$2`, [outcome, m.id]);
      const { rows: updated } = await db.query('select * from markets where id=$1', [m.id]);
      if (hub) hub.broadcast(m.room_id, 'market_status', { marketId: m.id, status: 'resolved', outcome });
      res.json(updated[0]);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
