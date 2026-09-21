import { randomUUID } from 'node:crypto';
import { PantaError } from './errors.js';
import { priceYes, priceNo, sharesForSpend, round6 } from '../sim/lmsr.js';

export function createSimClient({ db, env }) {
  const B = Number(env.SIM_LIQUIDITY_B);
  const FEE_BPS = Number(env.SIM_FEE_BPS);
  const CREATOR_SHARE_BPS = Number(env.SIM_CREATOR_SHARE_BPS);
  const GRADUATION_VOLUME = Number(env.SIM_GRADUATION_VOLUME);

  // in-memory quote stores
  const marketQuotes = new Map(); // quoteId -> {roomId, question,... expiresAt}
  const orderQuotes = new Map();

  function now() {
    return new Date();
  }

  return {
    mode: 'sim',
    async listMarkets({ _category, limit } = {}) {
      const { rows } = await db.query('select * from markets order by created_at desc limit $1', [limit || 50]);
      return { source: 'sim', items: rows };
    },
    async getMarket(id) {
      const { rows } = await db.query('select * from markets where id=$1 or panta_market_id=$1', [id]);
      if (rows.length === 0) throw new PantaError('NOT_FOUND', 'Market not found', { status: 404 });
      return rows[0];
    },
    async quoteCreate(input) {
      // input: { roomId, question, resolutionRule, sourcesOfTruth, endInMinutes, category, wallet? }
      const fee = 1.0; // sim creation fee 1 USDC placeholder
      const quoteId = randomUUID();
      const expiresAt = new Date(Date.now() + 90 * 1000).toISOString();
      marketQuotes.set(quoteId, { ...input, fee, expiresAt });
      // auto expire
      setTimeout(() => marketQuotes.delete(quoteId), 95 * 1000);
      return { quoteId, fee, currency: 'USDC', expiresAt, source: 'sim' };
    },
    async buildCreate(quoteId, wallet) {
      const q = marketQuotes.get(quoteId);
      if (!q) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
      if (new Date(q.expiresAt) <= now()) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
      const signPayload = { kind: 'create_market', quoteId, wallet, question: q.question, nonce: randomUUID() };
      // mark built? keep quote
      return { signPayload, quoteId, wallet };
    },
    async registerMarket(quoteId, signature, userId) {
      const q = marketQuotes.get(quoteId);
      if (!q) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
      // check duplicate
      const { rows: dup } = await db.query('select id from markets where creator_id=$1 and question=$2', [userId, q.question]);
      if (dup.length > 0) throw new PantaError('DUPLICATE_MARKET', 'Duplicate market', { status: 409 });
      const id = randomUUID();
      const start = new Date().toISOString();
      const end = new Date(Date.now() + (q.endInMinutes || 10) * 60000).toISOString();
      const resolution = new Date(Date.now() + (q.endInMinutes || 10) * 60000 + 5 * 60000).toISOString();
      const imageUrl = `https://via.placeholder.com/1024/15151C/FFFFFF?text=${encodeURIComponent(q.question.slice(0, 30))}`;
      await db.query(
        `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, image_url, start_time, end_time, resolution_time, yes_price, no_price)
         values($1,$2,$3,'sim',$4,$5,$6,$7,$8,$9,$10,$11,0.5,0.5)`,
        [id, q.roomId, userId, q.question, q.resolutionRule, q.sourcesOfTruth, q.category || 'gaming', imageUrl, start, end, resolution],
      );
      marketQuotes.delete(quoteId);
      // store signature trade? not needed for market creation
      const { rows } = await db.query('select * from markets where id=$1', [id]);
      return rows[0];
    },
    async quoteBuy({ marketId, side, amount, _wallet, userId }) {
      const { rows } = await db.query('select * from markets where id=$1', [marketId]);
      if (rows.length === 0) throw new PantaError('NOT_FOUND', 'Market not found', { status: 404 });
      const m = rows[0];
      if (m.status !== 'open') throw new PantaError('MARKET_CLOSED', 'Market closed', { status: 400 });
      if (new Date(m.end_time) <= now()) throw new PantaError('MARKET_CLOSED', 'Market closed', { status: 400 });
      if (amount < 1) throw new PantaError('AMOUNT_TOO_SMALL', 'Amount too small', { status: 400 });
      // check balance
      const { rows: bRows } = await db.query('select sim_usdc from balances where user_id=$1', [userId]);
      const bal = bRows.length ? Number(bRows[0].sim_usdc) : 0;
      if (bal < amount) throw new PantaError('INSUFFICIENT_FUNDS', 'Insufficient funds', { status: 400 });
      const qy = Number(m.q_yes);
      const qn = Number(m.q_no);
      const fee = round6((amount * FEE_BPS) / 10000);
      const net = round6(amount - fee);
      const shares = sharesForSpend(qy, qn, side, net, B);
      const currentPrice = side === 'yes' ? priceYes(qy, qn, B) : priceNo(qy, qn, B);
      const orderId = randomUUID();
      const expiresAt = new Date(Date.now() + 90 * 1000).toISOString();
      orderQuotes.set(orderId, { marketId, side, amount, fee, shares, quoted_price: currentPrice, expiresAt, userId });
      // persist order row
      await db.query(
        `insert into orders(id, user_id, market_id, side, amount, fee, shares, quoted_price, expires_at, status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'quoted')`,
        [orderId, userId, marketId, side, amount, fee, shares, currentPrice, expiresAt],
      );
      setTimeout(() => orderQuotes.delete(orderId), 95 * 1000);
      const payoutIfWin = shares; // 1 per share
      return { orderId, price: round6(currentPrice), shares, fee, expiresAt, payoutIfWin, source: 'sim' };
    },
    async buildBuy(quoteId) {
      const q = orderQuotes.get(quoteId);
      if (!q) {
        // fallback to db
        const { rows } = await db.query('select * from orders where id=$1', [quoteId]);
        if (rows.length === 0) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
        const r = rows[0];
        if (new Date(r.expires_at) <= now()) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
        const { rows: mRows } = await db.query('select * from markets where id=$1', [r.market_id]);
        const m = mRows[0];
        const currentPrice = r.side === 'yes' ? priceYes(Number(m.q_yes), Number(m.q_no), B) : priceNo(Number(m.q_yes), Number(m.q_no), B);
        if (Math.abs(currentPrice - Number(r.quoted_price)) * 10000 > r.max_slippage_bps) {
          throw new PantaError('QUOTE_STALE', 'Price moved', { status: 409 });
        }
        await db.query(`update orders set status='built' where id=$1`, [quoteId]);
        return { signPayload: { orderId: quoteId, marketId: r.market_id, side: r.side, amount: Number(r.amount), expiresAt: r.expires_at }, preview: false, orderId: quoteId };
      }
      // check stale
      const { rows: mRows } = await db.query('select * from markets where id=$1', [q.marketId]);
      const m = mRows[0];
      const currentPrice = q.side === 'yes' ? priceYes(Number(m.q_yes), Number(m.q_no), B) : priceNo(Number(m.q_yes), Number(m.q_no), B);
      if (Math.abs(currentPrice - q.quoted_price) * 10000 > 100) {
        throw new PantaError('QUOTE_STALE', 'Price moved', { status: 409 });
      }
      if (new Date(q.expiresAt) <= now()) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
      await db.query(`update orders set status='built' where id=$1`, [quoteId]);
      return { signPayload: { orderId: quoteId, marketId: q.marketId, side: q.side, amount: q.amount, expiresAt: q.expiresAt }, preview: false, orderId: quoteId };
    },
    async submitBuy(quoteId, signature, walletUserId) {
      // idempotent on signature
      const { rows: existing } = await db.query('select * from trades where signature=$1', [signature]);
      if (existing.length > 0) {
        // return original order info
        const t = existing[0];
        return { trade: t, idempotent: true };
      }
      // need order
      const { rows: oRows } = await db.query('select * from orders where id=$1', [quoteId]);
      if (oRows.length === 0) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
      const order = oRows[0];
      if (order.user_id !== walletUserId) throw new PantaError('FORBIDDEN', 'Not your order', { status: 403 });
      if (new Date(order.expires_at) <= now()) throw new PantaError('QUOTE_EXPIRED', 'Quote expired', { status: 410 });
      // do ledger update in transaction
      return db.tx(async ({ query }) => {
        // lock market
        const { rows: mRows } = await query('select * from markets where id=$1', [order.market_id]);
        if (mRows.length === 0) throw new PantaError('NOT_FOUND', 'Market not found', { status: 404 });
        const m = mRows[0];
        if (m.status !== 'open') throw new PantaError('MARKET_CLOSED', 'Market closed', { status: 400 });
        const qy = Number(m.q_yes);
        const qn = Number(m.q_no);
        const currentPrice = order.side === 'yes' ? priceYes(qy, qn, B) : priceNo(qy, qn, B);
        if (Math.abs(currentPrice - Number(order.quoted_price)) * 10000 > Number(order.max_slippage_bps)) {
          throw new PantaError('QUOTE_STALE', 'Price moved', { status: 409 });
        }
        // check balance for update
        const { rows: bRows } = await query('select sim_usdc from balances where user_id=$1', [order.user_id]);
        const bal = bRows.length ? Number(bRows[0].sim_usdc) : 0;
        if (bal < Number(order.amount)) throw new PantaError('INSUFFICIENT_FUNDS', 'Insufficient funds', { status: 400 });
        const fee = Number(order.fee);
        // const net = round6(Number(order.amount) - fee); // Already calculated in quote
        const shares = Number(order.shares);
        // update q's
        let newQy = qy, newQn = qn;
        // recompute q update via cost math: we already have shares; increment qSide
        if (order.side === 'yes') newQy = round6(qy + shares);
        else newQn = round6(qn + shares);
        const newYesPrice = round6(priceYes(newQy, newQn, B));
        const newNoPrice = round6(priceNo(newQy, newQn, B));
        const creatorShare = round6((fee * CREATOR_SHARE_BPS) / 10000);
        const newVolume = round6(Number(m.volume) + Number(order.amount));
        const graduated = newVolume >= GRADUATION_VOLUME ? true : m.graduated;
        await query(`update markets set q_yes=$1, q_no=$2, yes_price=$3, no_price=$4, volume=$5, creator_fees_accrued = creator_fees_accrued + $6, graduated=$7 where id=$8`, [newQy, newQn, newYesPrice, newNoPrice, newVolume, creatorShare, graduated, m.id]);
        await query(`update balances set sim_usdc = sim_usdc - $1 where user_id=$2`, [order.amount, order.user_id]);
        // positions
        const { rows: posRows } = await query('select * from positions where user_id=$1 and market_id=$2', [order.user_id, order.market_id]);
        if (posRows.length === 0) {
          await query(`insert into positions(user_id, market_id, yes_shares, no_shares) values($1,$2,$3,$4)`, [order.user_id, order.market_id, order.side === 'yes' ? shares : 0, order.side === 'no' ? shares : 0]);
        } else {
          if (order.side === 'yes') await query(`update positions set yes_shares = yes_shares + $1 where user_id=$2 and market_id=$3`, [shares, order.user_id, order.market_id]);
          else await query(`update positions set no_shares = no_shares + $1 where user_id=$2 and market_id=$3`, [shares, order.user_id, order.market_id]);
        }
        await query(`update orders set status='confirmed' where id=$1`, [order.id]);
        const tradeId = randomUUID();
        await query(`insert into trades(id, user_id, market_id, order_id, kind, side, amount, shares, signature) values($1,$2,$3,$4,'buy',$5,$6,$7,$8)`, [tradeId, order.user_id, order.market_id, order.id, order.side, order.amount, shares, signature]);
        // update chat? caller will do
        const { rows: updatedM } = await query('select * from markets where id=$1', [m.id]);
        return { trade: { id: tradeId, market_id: m.id, side: order.side, amount: order.amount, shares }, market: updatedM[0], idempotent: false };
      });
    },
    async getPositions(walletOrUserId) {
      // for sim, walletOrUserId is userId
      const { rows } = await db.query('select p.*, m.question, m.status, m.outcome, m.yes_price, m.no_price from positions p join markets m on m.id=p.market_id where p.user_id=$1', [walletOrUserId]);
      return rows;
    },
    async getMetrics({ userId }) {
      const { rows: vol } = await db.query(`select coalesce(sum(amount),0) as total, count(*) as cnt, count(distinct user_id) as traders from trades where market_id in (select id from markets where creator_id=$1) and kind='buy'`, [userId]);
      const { rows: byMarket } = await db.query(`select m.id, m.question, coalesce(sum(t.amount),0) as vol, count(t.id) as trades from markets m left join trades t on t.market_id=m.id and t.kind='buy' where m.creator_id=$1 group by m.id`, [userId]);
      const { rows: fees } = await db.query(`select coalesce(sum(creator_fees_accrued),0) as fees from markets where creator_id=$1`, [userId]);
      return { totalVolume: Number(vol[0].total), tradeCount: Number(vol[0].cnt), uniqueTraders: Number(vol[0].traders), byMarket, creatorFeesAccrued: Number(fees[0].fees) };
    },
    // claims
    async buildClaim({ marketId }) {
      return { signPayload: { kind: 'claim_win', marketId, nonce: randomUUID() } };
    },
    async submitClaim({ marketId, _wallet, signature, userId }) {
      const { rows: mRows } = await db.query('select * from markets where id=$1', [marketId]);
      if (mRows.length === 0) throw new PantaError('NOT_FOUND', 'Market not found', { status: 404 });
      const m = mRows[0];
      if (m.status !== 'resolved') throw new PantaError('NOT_CLAIMABLE', 'Market not resolved', { status: 400 });
      const { rows: posRows } = await db.query('select * from positions where user_id=$1 and market_id=$2', [userId, marketId]);
      if (posRows.length === 0) throw new PantaError('NOT_CLAIMABLE', 'No position', { status: 400 });
      const pos = posRows[0];
      if (pos.claimed) throw new PantaError('NOT_CLAIMABLE', 'Already claimed', { status: 400 });
      const winningShares = m.outcome === 'yes' ? Number(pos.yes_shares) : Number(pos.no_shares);
      if (winningShares <= 0) throw new PantaError('NOT_CLAIMABLE', 'No winning shares', { status: 400 });
      // idempotent via trades signature uniqueness
      const { rows: existing } = await db.query('select * from trades where signature=$1', [signature]);
      if (existing.length > 0) return { amount: winningShares, idempotent: true };
      return db.tx(async ({ query }) => {
        await query(`update positions set claimed=true where user_id=$1 and market_id=$2`, [userId, marketId]);
        await query(`update balances set sim_usdc = sim_usdc + $1 where user_id=$2`, [winningShares, userId]);
        const tid = randomUUID();
        await query(`insert into trades(id, user_id, market_id, kind, side, amount, shares, signature) values($1,$2,$3,'claim',$4,$5,$6,$7)`, [tid, userId, marketId, m.outcome, winningShares, winningShares, signature]);
        return { amount: winningShares, tradeId: tid };
      });
    },
    async buildCreatorFeeClaim({ marketId }) {
      return { signPayload: { kind: 'claim_creator_fees', marketId, nonce: randomUUID() } };
    },
    async submitCreatorFeeClaim({ marketId, _wallet, signature, userId }) {
      const { rows: mRows } = await db.query('select * from markets where id=$1', [marketId]);
      if (mRows.length === 0) throw new PantaError('NOT_FOUND', 'Market not found', { status: 404 });
      const m = mRows[0];
      if (m.creator_id !== userId) throw new PantaError('FORBIDDEN', 'Not creator', { status: 403 });
      if (m.status !== 'resolved') throw new PantaError('MARKET_NOT_GRADUATED', 'Market not resolved', { status: 400 });
      if (!m.graduated) throw new PantaError('MARKET_NOT_GRADUATED', 'Market not graduated', { status: 400 });
      if (m.creator_fees_claimed) throw new PantaError('NOT_CLAIMABLE', 'Already claimed', { status: 400 });
      const { rows: existing } = await db.query('select * from trades where signature=$1', [signature]);
      if (existing.length > 0) return { amount: Number(m.creator_fees_accrued), idempotent: true };
      const amount = Number(m.creator_fees_accrued);
      if (amount <= 0) throw new PantaError('NOT_CLAIMABLE', 'No fees to claim', { status: 400 });
      return db.tx(async ({ query }) => {
        await query(`update markets set creator_fees_claimed=true where id=$1`, [marketId]);
        await query(`update balances set sim_usdc = sim_usdc + $1 where user_id=$2`, [amount, userId]);
        const tid = randomUUID();
        await query(`insert into trades(id, user_id, market_id, kind, amount, signature) values($1,$2,$3,'creator_fee_claim',$4,$5)`, [tid, userId, marketId, amount, signature]);
        return { amount, tradeId: tid };
      });
    },
  };
}
