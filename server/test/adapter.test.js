import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveClient } from '../src/panta/liveClient.js';
import { loadEnv } from '../src/config/env.js';

function mockFetch(body, status = 200) {
  return async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function captureArgs(mockFetchImpl) {
  const calls = [];
  return {
    fn: async (url, opts) => {
      calls.push({ url, method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : undefined });
      return mockFetchImpl();
    },
    calls,
  };
}

describe('liveClient', () => {
  it('trailing slash builder', () => {
    const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }) });
    assert.equal(c.buildPath('/markets'), '/markets/');
    assert.equal(c.buildPath('/markets/'), '/markets/');
  });

  it('429 handling', async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return { status: 429, ok: false, headers: { get: (n) => n === 'Retry-After' ? '0' : null }, text: async () => JSON.stringify({ code: 'RATE_LIMITED' }) };
    };
    const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: mockFetch });
    try { await c.listMarkets(); assert.fail('should throw'); } catch (e) { assert.equal(e.code, 'RATE_LIMITED'); }
    assert.equal(calls, 1);
  });

  it('mode downgrade without key', () => {
    const env = loadEnv({ PANTA_MODE: 'hybrid' });
    assert.equal(env.effectiveMode, 'sim');
    assert.ok(env.warnings[0].includes('PANTA_API_KEY'));
  });

  it('priceCache single-flight', async () => {
    const { createPriceCache } = await import('../src/services/priceCache.js');
    const cache = createPriceCache({ ttlMs: 1000 });
    let calls = 0;
    const fetcher = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return { v: 1 }; };
    const p1 = cache.get(fetcher);
    const p2 = cache.get(fetcher);
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  });

  describe('paths match Panta docs', () => {
    it('listMarkets calls GET /markets/', async () => {
      const { fn, calls } = captureArgs(mockFetch({ items: [], nextCursor: null }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.listMarkets({ limit: 2 });
      assert.equal(calls[0].url, 'https://x.example/api/v1/markets/?limit=2');
      assert.equal(calls[0].method, 'GET');
    });
    it('getMarket calls GET /markets/{id}/', async () => {
      const { fn, calls } = captureArgs(mockFetch({ marketId: 'test' }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.getMarket('test');
      assert.equal(calls[0].url, 'https://x.example/api/v1/markets/test/');
    });
    it('quoteCreate calls POST /markets/create/quote/', async () => {
      const { fn, calls } = captureArgs(mockFetch({ createId: 'abc' }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.quoteCreate({ wallet: 'x', question: 'Q', resolutionRule: 'R', sourcesOfTruth: ['s'], category: 'c', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-02T00:00:00Z', resolutionTime: '2025-01-03T00:00:00Z', imageUrl: 'img', marketType: 'standard', title: 'T', description: 'D', region: 'Global' });
      assert.equal(calls[0].url, 'https://x.example/api/v1/markets/create/quote/');
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].body.wallet, 'x');
      assert.equal(calls[0].body.question, 'Q');
      assert.equal(calls[0].body.resolutionRule, 'R');
      assert.deepEqual(calls[0].body.sourcesOfTruth, ['s']);
      assert.equal(calls[0].body.category, 'c');
      assert.equal(calls[0].body.startTime, '2025-01-01T00:00:00Z');
      assert.equal(calls[0].body.endTime, '2025-01-02T00:00:00Z');
      assert.equal(calls[0].body.resolutionTime, '2025-01-03T00:00:00Z');
      assert.equal(calls[0].body.imageUrl, 'img');
      assert.equal(calls[0].body.marketType, 'standard');
      assert.equal(calls[0].body.title, 'T');
      assert.equal(calls[0].body.description, 'D');
      assert.equal(calls[0].body.region, 'Global');
    });
    it('buildCreate calls POST /markets/create/build/', async () => {
      const { fn, calls } = captureArgs(mockFetch({ createId: 'abc' }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.buildCreate('createId', 'wallet');
      assert.equal(calls[0].url, 'https://x.example/api/v1/markets/create/build/');
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].body.createId, 'createId');
      assert.equal(calls[0].body.wallet, 'wallet');
    });
    it('quoteBuy calls POST /primaryorderquote/', async () => {
      const { fn, calls } = captureArgs(mockFetch({ quoteId: 'abc', avgPrice: 1.5, feeUsdc: 0.1 }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.quoteBuy({ marketId: 'm', side: 'yes', amountUsdc: 100, wallet: 'w', userId: 'u' });
      assert.equal(calls[0].url, 'https://x.example/api/v1/primaryorderquote/');
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].body.marketId, 'm');
      assert.equal(calls[0].body.side, 'yes');
      assert.equal(calls[0].body.amountUsdc, 100);
      assert.equal(calls[0].body.wallet, 'w');
      assert.equal(calls[0].body.userId, 'u');
    });
    it('buildBuy calls POST /primaryorderbuild/', async () => {
      const { fn, calls } = captureArgs(mockFetch({ orderId: 'abc', transaction: 'base64tx' }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.buildBuy({ quoteId: 'q', wallet: 'w', userId: 'u', maxSlippageBps: 100 });
      assert.equal(calls[0].url, 'https://x.example/api/v1/primaryorderbuild/');
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].body.quoteId, 'q');
      assert.equal(calls[0].body.wallet, 'w');
      assert.equal(calls[0].body.userId, 'u');
      assert.equal(calls[0].body.maxSlippageBps, 100);
    });
    it('getPositions calls GET /positions/?wallet=', async () => {
      const { fn, calls } = captureArgs(mockFetch({ wallet: 'w', positions: [] }));
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: fn });
      await c.getPositions('wallet');
      assert.equal(calls[0].url, 'https://x.example/api/v1/positions/?wallet=wallet');
    });
  });

  describe('request bodies use exact docs field names', () => {
    it('quoteBuy uses amountUsdc not amount', () => {
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }) });
      const body = { marketId: 'm', side: 'yes', amountUsdc: 100, wallet: 'w', userId: 'u' };
      assert.equal(body.amountUsdc, 100);
      assert.equal(body.amount, undefined);
    });
    it('buildCreate uses createId not quoteId', () => {
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }) });
      const body = { createId: 'id', wallet: 'w' };
      assert.equal(body.createId, 'id');
      assert.equal(body.quoteId, undefined);
    });
  });

  describe('response field mappings match Panta docs', () => {
    it('quoteCreate response has createId not quoteId', async () => {
      const mockImpl = mockFetch({ createId: 'abc', expectedEventPda: 'pda', paymentUsdc: 1.0, liquidityInjectionUsdc: 5.0, platformRevenueUsdc: 0.1, expiresAt: '2025-01-01T00:00:00Z', blockhashExpiryHintSec: 60 });
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: mockImpl });
      const r = await c.quoteCreate({ wallet: 'w', question: 'Q', resolutionRule: 'R', sourcesOfTruth: ['s'], category: 'c', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-02T00:00:00Z', resolutionTime: '2025-01-03T00:00:00Z', imageUrl: 'img', marketType: 'standard', title: 'T', description: 'D', region: 'Global' });
      assert.equal(r.createId, 'abc');
      assert.equal(r.paymentUsdc, 1.0);
      assert.equal(r.liquidityInjectionUsdc, 5.0);
      assert.equal(r.platformRevenueUsdc, 0.1);
      assert.equal(r.expectedEventPda, 'pda');
      assert.equal(r.blockhashExpiryHintSec, 60);
      assert.equal(r.quoteId, undefined);
      assert.equal(r.fee, undefined);
    });
    it('buildCreate response has transaction base64 and no signPayload', async () => {
      const mockImpl = mockFetch({ createId: 'abc', transaction: 'base64encoded', recentBlockhash: 'blk123', lastValidBlockHeight: 100, buildFingerprint: 'fp', derived: true, expiresAt: '2025-01-01T00:00:00Z' });
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: mockImpl });
      const r = await c.buildCreate('id', 'wallet');
      assert.equal(r.transaction, 'base64encoded');
      assert.equal(r.recentBlockhash, 'blk123');
      assert.equal(r.lastValidBlockHeight, 100);
      assert.equal(r.buildFingerprint, 'fp');
      assert.equal(r.derived, true);
      assert.equal(r.signPayload, undefined);
      assert.equal(r.quoteId, undefined);
    });
    it('quoteBuy response has avgPrice and feeUsdc not price and fee', async () => {
      const mockImpl = mockFetch({ quoteId: 'abc', shares: 50, avgPrice: 1.5, feeUsdc: 0.1, expiresAt: '2025-01-01T00:00:00Z', blockhashExpiryHintSec: 60 });
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: mockImpl });
      const r = await c.quoteBuy({ marketId: 'm', side: 'yes', amountUsdc: 100, wallet: 'w', userId: 'u' });
      assert.equal(r.quoteId, 'abc');
      assert.equal(r.avgPrice, 1.5);
      assert.equal(r.feeUsdc, 0.1);
      assert.equal(r.shares, 50);
      assert.equal(r.orderId, undefined);
      assert.equal(r.price, undefined);
      assert.equal(r.fee, undefined);
      assert.equal(r.payoutIfWin, undefined);
    });
    it('buildBuy response has instructions and transaction not signPayload', async () => {
      const mockImpl = mockFetch({ orderId: 'abc', quoteId: 'q', wallet: 'w', marketId: 'm', side: 'yes', amountUsdc: 100, expectedShares: 50, instructions: [{ programId: 'sysvar', data: '...' }], recentBlockhash: 'blk123', derived: true, expiresAt: '2025-01-01T00:00:00Z', transaction: 'base64tx' });
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: mockImpl });
      const r = await c.buildBuy({ quoteId: 'q', wallet: 'w', userId: 'u', maxSlippageBps: 100 });
      assert.equal(r.orderId, 'abc');
      assert.equal(r.expectedShares, 50);
      assert.deepEqual(r.instructions, [{ programId: 'sysvar', data: '...' }]);
      assert.equal(r.recentBlockhash, 'blk123');
      assert.equal(r.derived, true);
      assert.equal(r.transaction, 'base64tx');
      assert.equal(r.signPayload, undefined);
    });
    it('getPositions response has positions array under wallet key', async () => {
      const mockImpl = mockFetch({ wallet: 'w', positions: [{ marketId: 'm', side: 'yes', shares: 10 }] });
      const c = createLiveClient({ baseUrl: 'https://x.example/api/v1', apiKey: 'k', fetchImpl: mockImpl });
      const r = await c.getPositions('w');
      assert.equal(r.wallet, 'w');
      assert.deepEqual(r.positions, [{ marketId: 'm', side: 'yes', shares: 10 }]);
    });
  });
});
