import { createSimClient } from './simClient.js';
import { createLiveClient } from './liveClient.js';

export function createHybrid({ db, env }) {
  const sim = createSimClient({ db, env });
  const live = env.PANTA_API_KEY ? createLiveClient({ baseUrl: env.PANTA_BASE_URL, apiKey: env.PANTA_API_KEY }) : null;

  // routing per spec
  return {
    mode: 'hybrid',
    async listMarkets(args) {
      if (live) {
        try {
          const r = await live.listMarkets(args);
          return { source: 'panta', items: r.items || r.markets || [] };
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.listMarkets(args);
    },
    async getMarket(id) {
      // try live for real ids, fallback sim
      if (live) {
        try {
          const r = await live.getMarket(id);
          return r;
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.getMarket(id);
    },
    async quoteCreate(input) {
      if (live) {
        try {
          const r = await live.quoteCreate(input);
          return { ...r, source: 'panta', realQuote: r };
        } catch (e) {
          // fallback to sim quote but include error
          const simQ = await sim.quoteCreate(input);
          return { ...simQ, liveError: e.message };
        }
      }
      return sim.quoteCreate(input);
    },
    async buildCreate(quoteId, wallet) {
      if (live) {
        try {
          return await live.buildCreate(quoteId, wallet);
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.buildCreate(quoteId, wallet);
    },
    async registerMarket(quoteId, signature, userId) {
      return sim.registerMarket(quoteId, signature, userId);
    },
    async quoteBuy(args) {
      // for sim markets use sim, for panta markets preview live
      const { rows } = await db.query('select source from markets where id=$1', [args.marketId]);
      const source = rows[0]?.source || 'sim';
      if (source === 'panta' && live) {
        try {
          const r = await live.quoteBuy(args);
          return { ...r, source: 'panta', preview: true };
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.quoteBuy(args);
    },
    async buildBuy(quoteId) {
      // check market source
      // we need to fetch order to know market
      const { rows } = await db.query('select market_id from orders where id=$1', [quoteId]);
      if (rows.length) {
        const { rows: mRows } = await db.query('select source from markets where id=$1', [rows[0].market_id]);
        if (mRows[0]?.source === 'panta' && live) {
          try {
            const r = await live.buildBuy(quoteId);
            return { ...r, preview: true };
          } catch {
            // Fallback to sim on error
          }
        }
      }
      return sim.buildBuy(quoteId);
    },
    async submitBuy(...args) {
      return sim.submitBuy(...args);
    },
    async getPositions(walletOrUserId) {
      if (live && walletOrUserId && walletOrUserId.length > 30) {
        try {
          const r = await live.getPositions(walletOrUserId);
          if (r && (r.positions || r.items)) return r.positions || r.items;
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.getPositions(walletOrUserId);
    },
    async getMetrics(args) {
      return sim.getMetrics(args);
    },
    async buildClaim(args) {
      return sim.buildClaim(args);
    },
    async submitClaim(args) {
      return sim.submitClaim(args);
    },
    async buildCreatorFeeClaim(args) {
      return sim.buildCreatorFeeClaim(args);
    },
    async submitCreatorFeeClaim(args) {
      return sim.submitCreatorFeeClaim(args);
    },
    // expose sim for direct access if needed
    _sim: sim,
    _live: live,
  };
}
