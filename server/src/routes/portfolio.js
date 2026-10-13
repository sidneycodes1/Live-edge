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

      // Active positions only: keep open un-cashed bets + claimable resolved bets.
      // Cashed out, claimed, lost, or closed bets belong in History. A resolved
      // LOSING bet never flips p.claimed (there is nothing to claim), so the
      // winner check has to live here or losers haunt the Live tab.
      const { rows: posRows } = await db.query(
        `select p.*, m.question, m.status, m.outcome, m.yes_price, m.no_price, m.volume, m.image_url, m.end_time
         from positions p join markets m on m.id=p.market_id
         where p.user_id=$1 and m.status <> 'closed'
           and (
             (m.status = 'open' and (p.yes_shares > 0 or p.no_shares > 0))
             or
             (m.status = 'resolved' and not p.claimed
               and ((m.outcome = 'yes' and p.yes_shares > 0) or (m.outcome = 'no' and p.no_shares > 0)))
           )`,
        [userId],
      );

      // s8 in-play value + settle/loss: the honest COST BASIS per market is the
      // sum of that user's 'buy' trade amounts (what they actually paid). We read
      // it straight off the existing trades tape — no parallel accounting, no
      // invented stake. A missing row (seeded position with no recorded buy)
      // honestly contributes $0 invested, so P/L is never overstated.
      const { rows: investedRows } = await db.query(
        `select market_id, sum(amount) as invested from trades
         where user_id=$1 and kind='buy' group by market_id`,
        [userId],
      );
      const investedByMarket = new Map(investedRows.map((r) => [String(r.market_id), Number(r.invested) || 0]));

      const positions = posRows.map((p) => {
        const status = p.status;
        const yesShares = Number(p.yes_shares);
        const noShares = Number(p.no_shares);
        let claimable = false;
        let claimAmount = 0;
        if (status === 'resolved' && !p.claimed) {
          const winning = p.outcome === 'yes' ? yesShares : noShares;
          if (winning > 0) {
            claimable = true;
            claimAmount = winning;
          }
        }
        const invested = investedByMarket.get(String(p.market_id)) ?? 0;
        // Mark-to-market at the CURRENT price. For an OPEN bet this is the live
        // in-play value the owner asked to see "tick up". For a RESOLVED bet the
        // real number is the settlement payout below (a sim resolve leaves the
        // LMSR price mid-board, so currentValue is NOT the payoff there).
        const currentValue = yesShares * Number(p.yes_price) + noShares * Number(p.no_price);
        // Honest unrealized P/L for the still-running position only.
        const unrealizedPnl = status === 'open' ? currentValue - invested : null;
        // Settle/loss record: the true payoff of a resolved outcome — the winning
        // side's shares pay $1 each, the losing side pays nothing (→ a loss).
        let settlement = null;
        if (status === 'resolved') {
          const payout = p.outcome === 'yes' ? yesShares : noShares;
          settlement = { outcome: p.outcome, won: payout > 0, payout, realizedPnl: payout - invested };
        }
        return {
          market: { id: p.market_id, question: p.question, status: p.status, outcome: p.outcome, image_url: p.image_url, end_time: p.end_time, yes_price: Number(p.yes_price), no_price: Number(p.no_price) },
          yesShares,
          noShares,
          claimed: p.claimed,
          claimable,
          claimAmount,
          currentValue,
          invested,
          unrealizedPnl,
          settlement,
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

  r.get('/history', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);

      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

      const { rows: marketRows } = await db.query(
        `select distinct m.id, m.question, m.status, m.outcome, m.image_url, m.end_time, m.resolution_time, m.created_at
         from markets m
         where m.id in (
           select market_id from trades where user_id = $1
           union
           select market_id from positions where user_id = $1
         )`,
        [userId],
      );

      const { rows: trades } = await db.query(
        `select market_id, kind, side, amount, shares, created_at
         from trades where user_id = $1
         order by created_at asc`,
        [userId],
      );

      const { rows: positions } = await db.query(
        `select * from positions where user_id = $1`,
        [userId],
      );

      const historyItems = [];

      for (const m of marketRows) {
        const mTrades = trades.filter((t) => String(t.market_id) === String(m.id));
        const buyTrades = mTrades.filter((t) => t.kind === 'buy');
        const sellTrades = mTrades.filter((t) => t.kind === 'sell');
        const claimTrades = mTrades.filter((t) => t.kind === 'claim');
        const pos = positions.find((p) => String(p.market_id) === String(m.id));

        const hasSell = sellTrades.length > 0;
        const isClosed = m.status === 'closed';
        const isResolved = m.status === 'resolved';

        if (!hasSell && !isClosed && !isResolved) {
          continue; // still active open bet
        }

        const invested = buyTrades.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        let proceeds = 0;
        let outcome = 'lost';
        let closedAt = m.resolution_time || m.end_time || m.created_at;

        if (hasSell) {
          outcome = 'cashed';
          proceeds = sellTrades.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
          closedAt = sellTrades[sellTrades.length - 1].created_at;
        } else if (isResolved) {
          if (claimTrades.length > 0) {
            outcome = 'won';
            proceeds = claimTrades.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
            closedAt = claimTrades[claimTrades.length - 1].created_at;
          } else if (pos && pos.claimed) {
            outcome = 'won';
            const winningShares = m.outcome === 'yes' ? Number(pos.yes_shares || 0) : Number(pos.no_shares || 0);
            proceeds = winningShares;
          } else {
            const winningShares = pos ? (m.outcome === 'yes' ? Number(pos.yes_shares || 0) : Number(pos.no_shares || 0)) : 0;
            if (winningShares > 0) {
              // Stays on Live tab for claiming
              continue;
            }
            outcome = 'lost';
            proceeds = 0;
          }
        } else if (isClosed) {
          outcome = 'lost';
          proceeds = 0;
        }

        const side = (sellTrades[0]?.side) || (buyTrades[0]?.side) || (pos?.yes_shares > 0 ? 'yes' : 'no') || 'yes';
        const realizedPnl = proceeds - invested;

        historyItems.push({
          market: {
            id: m.id,
            question: m.question,
            image_url: m.image_url,
            status: m.status,
            outcome: m.outcome,
          },
          side,
          invested,
          proceeds,
          realizedPnl,
          outcome,
          closedAt,
        });
      }

      historyItems.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
      const paged = historyItems.slice(offset, offset + limit);

      res.json({
        items: paged,
        total: historyItems.length,
        count: paged.length,
        limit,
        offset,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
