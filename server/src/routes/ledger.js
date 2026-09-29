import { Router } from 'express';

// GET /api/ledger — unified transaction history (F-006).
//
// Read from the EXISTING balance-record sources, no parallel accounting:
//   • SPEND/EARN rows come straight from `trades` (buy / claim / creator_fee_claim);
//     the signed delta is derived from `kind` (buy debits, claims credit).
//   • MINT rows (welcome bonus + faucet) come from `mint_events`, the only money-in
//     events that had no prior history.
// The authoritative balance is never recomputed here — this is a display journal.
export function ledgerRouter({ db }) {
  const r = Router();

  const UNION = `
    select * from (
      select
        t.id::text as id,
        t.kind as kind,
        case t.kind
          when 'buy' then 'Trade'
          when 'claim' then 'Winnings'
          else 'Creator fees'
        end as label,
        (case t.kind when 'buy' then -1 else 1 end) * t.amount as delta,
        t.amount as amount,
        t.market_id::text as "marketId",
        t.created_at as "createdAt"
      from trades t
      where t.user_id = $1
      union all
      select
        m.id::text as id,
        m.kind as kind,
        case m.kind when 'welcome' then 'Welcome bonus' else 'Faucet top-up' end as label,
        m.amount as delta,
        m.amount as amount,
        null::text as "marketId",
        m.created_at as "createdAt"
      from mint_events m
      where m.user_id = $1
      union all
      select
        f.id::text as id,
        f.kind as kind,
        'Creation fee' as label,
        -f.amount as delta,
        f.amount as amount,
        f.market_id::text as "marketId",
        f.created_at as "createdAt"
      from fee_events f
      where f.user_id = $1
    ) ledger
    order by "createdAt" desc, id asc
    limit $2 offset $3`;

  r.get('/', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const { rows } = await db.query(UNION, [userId, limit, offset]);
      const items = rows.map((it) => ({
        id: it.id,
        kind: it.kind,
        label: it.label,
        delta: Number(it.delta),
        amount: Number(it.amount),
        marketId: it.marketId,
        createdAt: it.createdAt,
      }));
      res.json({ items, limit, offset, hasMore: items.length === limit });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
