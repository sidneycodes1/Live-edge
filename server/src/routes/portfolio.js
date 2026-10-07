import { Router } from 'express';

export function portfolioRouter({ db, _panta }) {
  const r = Router();

  r.get('/', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      // auto-close markets past end_time (same guard the room/market read paths and
      // the 10s background loop run). Doing it here too means an expired bet the
      // moment it matures is already 'closed' when the portfolio reads it below —
      // so "time's up" hides it immediately instead of lingering as a stale open row.
      await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);
      const { rows: bRows } = await db.query('select sim_usdc from balances where user_id=$1', [userId]);
      const balance = bRows.length ? Number(bRows[0].sim_usdc) : 0;

      // Active positions only: keep open + resolved (resolved stays so winnings can be
      // claimed), drop 'closed' (expired / wound-down) so old bets disappear from the
      // list. The stake still lives on in the transaction history.
      const { rows: posRows } = await db.query(
        `select p.*, m.question, m.status, m.outcome, m.yes_price, m.no_price, m.volume, m.image_url
         from positions p join markets m on m.id=p.market_id
         where p.user_id=$1 and m.status <> 'closed'`,
        [userId],
      );

      const positions = posRows.map((p) => {
        const status = p.status;
        let claimable = false;
        let claimAmount = 0;
        if (status === 'resolved' && !p.claimed) {
          const winning = p.outcome === 'yes' ? Number(p.yes_shares) : Number(p.no_shares);
          if (winning > 0) {
            claimable = true;
            claimAmount = winning;
          }
        }
        const currentValue = Number(p.yes_shares) * Number(p.yes_price) + Number(p.no_shares) * Number(p.no_price);
        return {
          market: { id: p.market_id, question: p.question, status: p.status, outcome: p.outcome, image_url: p.image_url },
          yesShares: Number(p.yes_shares),
          noShares: Number(p.no_shares),
          claimed: p.claimed,
          claimable,
          claimAmount,
          currentValue,
        };
      });

      // Same active-only rule for markets the user created: hide expired/closed ones
      // from "Created Markets"; open + resolved remain visible and claimable.
      const { rows: created } = await db.query(`select * from markets where creator_id=$1 and status <> 'closed'`, [userId]);
      const createdMarkets = created.map((m) => ({
        market: { id: m.id, question: m.question, status: m.status },
        creatorFeesAccrued: Number(m.creator_fees_accrued),
        creatorFeesClaimed: m.creator_fees_claimed,
        graduated: m.graduated,
        canClaimFees: m.status === 'resolved' && m.graduated && !m.creator_fees_claimed && Number(m.creator_fees_accrued) > 0,
        reason: !m.graduated ? 'Creator fees unlock when market graduates' : m.status !== 'resolved' ? 'Awaiting resolution' : undefined,
      }));

      res.json({ balance, positions, createdMarkets });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
