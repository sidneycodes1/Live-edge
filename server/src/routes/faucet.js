import { Router } from 'express';

export function faucetRouter({ db, notify }) {
  const r = Router();
  r.post('/', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      const { rows } = await db.query('select last_faucet_at, sim_usdc from balances where user_id=$1', [userId]);
      if (rows.length === 0) {
        // No balance row yet (user created outside the normal welcome flow): mint the
        // first $100 and journal it so the ledger + Phase 4.1 invariant stay complete.
        await db.tx(async ({ query }) => {
          await query('insert into balances(user_id, sim_usdc, last_faucet_at) values($1,100, now())', [userId]);
          await query(`insert into mint_events(user_id, kind, amount) values($1,'faucet',100)`, [userId]);
        });
        if (notify) await notify({ userId, kind: 'faucet', body: 'Faucet: +$100 added — balance $100.00' });
        return res.json({ balance: 100 });
      }
      const last = rows[0].last_faucet_at ? new Date(rows[0].last_faucet_at) : null;
      if (last && Date.now() - last.getTime() < 60 * 60 * 1000) {
        const retryAfter = Math.ceil((60 * 60 * 1000 - (Date.now() - last.getTime())) / 1000);
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Faucet once per hour', retryAfter } });
      }
      const { rows: cur } = await db.query('select sim_usdc from balances where user_id=$1', [userId]);
      const before = cur.length ? Number(cur[0].sim_usdc) : 0;
      const after = before + 100;
      // Debit the balance and append the mint journal row in one transaction so the
      // ledger can never show a top-up the wallet didn't actually receive (or vice versa).
      await db.tx(async ({ query }) => {
        await query(`update balances set sim_usdc = sim_usdc + 100, last_faucet_at=now() where user_id=$1`, [userId]);
        await query(`insert into mint_events(user_id, kind, amount) values($1,'faucet',100)`, [userId]);
      });
      if (notify) await notify({ userId, kind: 'faucet', body: `Faucet: +$100 added — balance $${after.toFixed(2)}` });
      res.json({ balance: after, added: 100 });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
