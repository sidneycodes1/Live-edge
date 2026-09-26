import { createSimClient } from './simClient.js';
import { createLiveClient } from './liveClient.js';

export function createHybrid({ db, env }) {
  const sim = createSimClient({ db, env });
  const live = env.PANTA_API_KEY ? createLiveClient({ baseUrl: env.PANTA_BASE_URL, apiKey: env.PANTA_API_KEY }) : null;

  function normalizeQuoteBuyLive(r) {
    return {
      ...r,
      orderId: r.quoteId || r.orderId,
      price: r.avgPrice || r.price,
      fee: r.feeUsdc || r.fee,
      quoteId: r.quoteId,
      avgPrice: r.avgPrice,
      feeUsdc: r.feeUsdc,
      shares: r.shares,
      expiresAt: r.expiresAt,
      transaction: r.transaction || null,
      instructions: r.instructions || null,
      recentBlockhash: r.recentBlockhash || null,
      derived: r.derived || null,
      source: 'panta',
      preview: true,
    };
  }

  function normalizeBuildBuyLive(r) {
    const txB64 = r.transaction || '';
    const txSummary = txB64 ? `unsigned Solana VersionedTransaction (${txB64.length} chars base64) — ${r.instructions?.length || 0} instructions, blockhash ${r.recentBlockhash?.slice(0, 8) || 'unknown'}` : '';
    return {
      ...r,
      signPayload: { type: 'unsigned_transaction', base64: r.transaction || '', instructions: r.instructions || [], recentBlockhash: r.recentBlockhash || '', lastValidBlockHeight: r.lastValidBlockHeight, marketId: r.marketId, side: r.side, amountUsdc: r.amountUsdc, expectedShares: r.expectedShares },
      canonicalPayload: r.transaction ? `unsigned_tx:${r.transaction.slice(0, 16)}` : undefined,
      transaction: r.transaction || null,
      instructions: r.instructions || null,
      recentBlockhash: r.recentBlockhash || null,
      derived: r.derived || null,
      expectedShares: r.expectedShares,
      orderId: r.orderId,
      quoteId: r.quoteId,
      wallet: r.wallet,
      marketId: r.marketId,
      side: r.side,
      amountUsdc: r.amountUsdc,
      transactionSummary: txSummary,
      preview: true,
      source: 'panta',
    };
  }

  function normalizeQuoteCreateLive(r) {
    return {
      ...r,
      quoteId: r.createId || r.quoteId,
      createId: r.createId,
      fee: r.paymentUsdc || r.fee,
      paymentUsdc: r.paymentUsdc,
      liquidityInjectionUsdc: r.liquidityInjectionUsdc,
      platformRevenueUsdc: r.platformRevenueUsdc,
      source: 'panta',
      preview: true,
    };
  }

  function normalizeBuildCreateLive(r) {
    return {
      ...r,
      signPayload: { type: 'unsigned_transaction', base64: r.transaction || '', instructions: r.instructions || [], recentBlockhash: r.recentBlockhash || '', lastValidBlockHeight: r.lastValidBlockHeight },
      canonicalPayload: r.transaction ? `unsigned_tx:${r.transaction.slice(0, 16)}` : undefined,
      quoteId: r.createId || r.quoteId,
      createId: r.createId,
      buildFingerprint: r.buildFingerprint,
      derived: r.derived,
      transaction: r.transaction || null,
      instructions: r.instructions || null,
      recentBlockhash: r.recentBlockhash || null,
      source: 'panta',
      preview: true,
    };
  }

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
          return normalizeQuoteCreateLive(r);
        } catch (e) {
          const simQ = await sim.quoteCreate(input);
          return { ...simQ, liveError: e.message };
        }
      }
      return sim.quoteCreate(input);
    },
    async buildCreate(createId, wallet) {
      if (live) {
        try {
          const r = await live.buildCreate(createId, wallet);
          return normalizeBuildCreateLive(r);
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.buildCreate(createId, wallet);
    },
    async registerMarket(quoteId, signature, userId) {
      return sim.registerMarket(quoteId, signature, userId);
    },
    async quoteBuy(args) {
      const { rows } = await db.query('select source from markets where id=$1', [args.marketId]);
      const source = rows[0]?.source || 'sim';
      if (source === 'panta' && live) {
        try {
          const liveArgs = { ...args, amountUsdc: args.amount, amount: undefined };
          const r = await live.quoteBuy(liveArgs);
          return normalizeQuoteBuyLive(r);
        } catch {
          // Fallback to sim on error
        }
      }
      return sim.quoteBuy(args);
    },
    async buildBuy(quoteIdObj) {
      const quoteId = typeof quoteIdObj === 'string' ? quoteIdObj : quoteIdObj.quoteId;
      const wallet = typeof quoteIdObj === 'string' ? undefined : (quoteIdObj.wallet || undefined);
      const userId = typeof quoteIdObj === 'string' ? undefined : (quoteIdObj.userId || undefined);
      const maxSlippageBps = typeof quoteIdObj === 'string' ? undefined : (quoteIdObj.maxSlippageBps || 100);
      const { rows } = await db.query('select market_id, wallet, user_id from orders where id=$1', [quoteId]);
      if (rows.length) {
        const { rows: mRows } = await db.query('select source from markets where id=$1', [rows[0].market_id]);
        if (mRows[0]?.source === 'panta' && live) {
          try {
            const r = await live.buildBuy({ quoteId, wallet: wallet || rows[0].wallet, userId: userId || rows[0].user_id, maxSlippageBps });
            return normalizeBuildBuyLive(r);
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
          if (r && r.positions) return r.positions;
          if (r && r.items) return r.items;
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
    _sim: sim,
    _live: live,
  };
}
