import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHybrid } from '../src/panta/hybrid.js';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';

// F-021 regression: hybrid.buildBuy used to run
//   `select market_id, wallet, user_id from orders ...`
// but the `orders` table has NO `wallet` column. Postgres rejects that at ANALYZE
// time, so EVERY hybrid trade 500'd — and because no test ever instantiated
// createHybrid, it shipped invisible. This test pins the schema-valid query.
describe('hybrid.buildBuy (F-021)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('reaches sim.buildBuy for an unknown quote (proves the orders SELECT is schema-valid)', async () => {
    const { db, env } = await makeApp();
    // Test env has no PANTA_API_KEY => live client is null => buildBuy must fall
    // through to sim.buildBuy, which raises a clean QUOTE_EXPIRED for an unknown id.
    const hybrid = createHybrid({ db, env });
    await assert.rejects(
      () => hybrid.buildBuy({ quoteId: randomUUID() }),
      (e) => e && e.code === 'QUOTE_EXPIRED',
      'buildBuy must route unknown quotes to sim (QUOTE_EXPIRED), not a DB schema error',
    );
  });

  it('resolves the order owner wallet via a users join (no orders.wallet reference)', async () => {
    const { db, env } = await makeApp();
    const calls = [];
    const spyDb = {
      query: (sql, params) => {
        calls.push(sql);
        return db.query(sql, params);
      },
    };
    const hybrid = createHybrid({ db: spyDb, env });
    await hybrid.buildBuy({ quoteId: randomUUID() }).catch(() => {});
    const ordersQuery = calls.find((sql) => /\bfrom orders\b/i.test(sql));
    assert.ok(ordersQuery, 'expected a query against the orders table');
    // The orders SELECT must never project a bare `wallet` column from orders;
    // it must source the wallet from the joined users table (u.wallet).
    assert.ok(/u\.wallet/i.test(ordersQuery), 'wallet must come from the users join');
    assert.ok(!/select\s+market_id,\s*wallet/i.test(ordersQuery), 'orders must not select a wallet column');
  });
});
