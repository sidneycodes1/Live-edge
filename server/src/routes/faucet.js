import { Router } from 'express';

export function faucetRouter({ db }) {
  const r = Router();
  r.post('/', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const userId = req.user.id;
      const { rows } = await db.query('select last_faucet_at, sim_usdc from balances where user_id=$1', [userId]);
      if (rows.length === 0) {
        await db.query('insert into balances(user_id, sim_usdc, last_faucet_at) values($1,100, now())', [userId]);
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
      await db.query(`update balances set sim_usdc = sim_usdc + 100, last_faucet_at=now() where user_id=$1`, [userId]);
      res.json({ balance: after, added: 100 });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
