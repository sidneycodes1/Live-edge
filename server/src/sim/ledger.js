import { PantaError } from '../panta/errors.js';

export function createLedger({ db, env }) {
  const B = Number(env.SIM_LIQUIDITY_B);
  const FEE_BPS = Number(env.SIM_FEE_BPS);
  const CREATOR_SHARE_BPS = Number(env.SIM_CREATOR_SHARE_BPS);

  async function ensureMarketOpen(market) {
    // close if past end_time
    if (market.status === 'open' && new Date(market.end_time) <= new Date()) {
      await db.query(`update markets set status='closed' where id=$1`, [market.id]);
      market.status = 'closed';
    }
    if (market.status !== 'open') {
      throw new PantaError('MARKET_CLOSED', 'Market is closed for trading', { status: 400 });
    }
  }

  return { B, FEE_BPS, CREATOR_SHARE_BPS, ensureMarketOpen };
}
