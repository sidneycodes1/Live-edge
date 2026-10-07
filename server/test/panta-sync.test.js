import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';
import { createPantaSync, PANTA_SYNC_USER, PANTA_SYNC_DEFAULTS, mapPantaRow } from '../src/services/pantaSync.js';
import { PantaError } from '../src/panta/errors.js';

// Fixed clock so the read-budget window + stale math are deterministic.
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0); // Oct 7 2026 12:00 UTC
const now = () => T0;

// A Panta-shaped list row (both the human-decimal and 9-dec-integer price spellings).
function pantaRow(over = {}) {
  return {
    marketId: '5HgpPrimaryMarketAddressExample111',
    question: 'Will the primary market resolve YES by the deadline?',
    title: 'Primary market sample',
    category: 'Crypto',
    images: ['https://res.cloudinary.com/panta/m.jpg'],
    phase: 'primary',
    status: 'primary',
    yesPrice: '0.62',
    noPrice: '0.38',
    volumeUsdc: '1234.5',
    isGraduated: true,
    creatorAddress: 'CreatorAddr123',
    isWhitelistedCreator: true,
    ...over,
  };
}

function fakeClient(items, { throws = null, nextCursor = null } = {}) {
  const c = { calls: 0, lastArgs: null };
  c.listMarkets = async (args) => {
    c.calls += 1;
    c.lastArgs = args;
    if (throws) throw throws;
    return { items, nextCursor };
  };
  c.getMarket = async () => ({});
  return c;
}

function fakeHub() {
  const broadcasts = [];
  return { broadcasts, broadcast(roomId, event, data) { broadcasts.push({ roomId, event, data }); } };
}

function newSync(db, liveClient, hub, extra = {}) {
  return createPantaSync({
    db,
    liveClient,
    hub: hub || null,
    env: {},
    enabled: true,
    now,
    warn: () => {},
    ...extra,
  });
}

describe('pantaSync/mapPantaRow', () => {
  it('reads the human-decimal price and clamps the question', () => {
    const m = mapPantaRow(pantaRow());
    assert.equal(m.pantaMarketId, '5HgpPrimaryMarketAddressExample111');
    assert.equal(m.yesPrice, 0.62);
    assert.equal(m.noPrice, 0.38);
    assert.equal(m.phase, 'primary');
    assert.equal(m.question.startsWith('Will the primary'), true);
  });
  it('converts a 9-decimal integer price to a fraction', () => {
    const m = mapPantaRow({ marketId: 'x', question: 'A nine-decimal price market here?', primaryYesPrice: '620000000' });
    assert.equal(m.yesPrice, 0.62);
    assert.equal(m.noPrice, 0.38);
  });
  it('derives the NO price from YES when NO is absent', () => {
    const m = mapPantaRow({ marketId: 'x', question: 'Derive the complement price here?', yesPrice: '0.7' });
    assert.equal(m.yesPrice, 0.7);
    assert.equal(m.noPrice, 0.3);
  });
  it('returns null prices for garbage (never fabricates a number)', () => {
    const m = mapPantaRow({ marketId: 'x', question: 'Garbage price should not be invented?', yesPrice: 'nonsense' });
    assert.equal(m.yesPrice, null);
    assert.equal(m.noPrice, null);
  });
  it('drops a row with no readable question (never an untethered/blank market)', () => {
    const m = mapPantaRow({ marketId: 'x', title: 'tiny', question: '' });
    assert.equal(m.question, null);
  });
});

describe('pantaSync/tick', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('DISABLE-SAFE: enabled=false → skipped, client never called, nothing written', async () => {
    const { db } = await makeApp();
    const c = fakeClient([pantaRow()]);
    const res = await newSync(db, c, null, { enabled: false }).tick();
    assert.equal(res.skipped, 'disabled');
    assert.equal(c.calls, 0);
    const { rows } = await db.query(`select count(*)::int c from markets where source='panta'`);
    assert.equal(rows[0].c, 0);
  });

  it('NO CLIENT: null liveClient → disabled skip, no crash', async () => {
    const { db } = await makeApp();
    const res = await createPantaSync({ db, liveClient: null, env: {}, enabled: true, now, warn: () => {} }).tick();
    assert.equal(res.skipped, 'disabled');
  });

  it('HAPPY: imports a primary market (source=panta, panta_live) + room + cache + odds broadcast', async () => {
    const { db } = await makeApp();
    const hub = fakeHub();
    const c = fakeClient([pantaRow()]);
    const res = await newSync(db, c, hub).tick();
    assert.equal(res.imported, 1);
    assert.equal(c.calls, 1);

    const { rows } = await db.query(`select * from markets where source='panta'`);
    assert.equal(rows.length, 1);
    const m = rows[0];
    assert.equal(m.panta_market_id, '5HgpPrimaryMarketAddressExample111');
    assert.equal(m.price_source, 'panta_live');
    assert.equal(Number(m.yes_price), 0.62);
    assert.ok(m.room_id, 'imported market owns a room (first-class bettable surface)');

    // room carries the real question as its title (never a placeholder)
    const { rows: rooms } = await db.query('select title from rooms where id=$1', [m.room_id]);
    assert.equal(rooms.length, 1);

    // cache row for honest degrade
    const { rows: cache } = await db.query('select * from panta_markets where panta_market_id=$1', [m.panta_market_id]);
    assert.equal(cache.length, 1);
    assert.equal(cache[0].price_source, 'panta_live');

    // odds fanned out to the room
    assert.equal(hub.broadcasts.length, 1);
    assert.equal(hub.broadcasts[0].event, 'odds');
    assert.equal(hub.broadcasts[0].data.priceSource, 'panta_live');

    // sync-state singleton updated
    const { rows: st } = await db.query('select * from panta_sync_state where id=1');
    assert.equal(st.length, 1);
    assert.ok(st[0].last_success_at);
  });

  it('UPSERT: a repeat poll updates the SAME market (no duplicate import)', async () => {
    const { db } = await makeApp();
    const row = pantaRow();
    await newSync(db, fakeClient([row])).tick();
    await newSync(db, fakeClient([{ ...row, yesPrice: '0.70' }])).tick();
    const { rows } = await db.query(`select * from markets where source='panta'`);
    assert.equal(rows.length, 1, 'one row per panta market id');
    assert.equal(Number(rows[0].yes_price), 0.7);
  });

  it('UPSTREAM ERROR (429): keeps last-known price, marks it stale, never wipes or fabricates', async () => {
    const { db } = await makeApp();
    await newSync(db, fakeClient([pantaRow()])).tick();
    const before = await db.query(`select yes_price from markets where source='panta'`);
    assert.equal(Number(before.rows[0].yes_price), 0.62);

    const errClient = fakeClient([], { throws: new PantaError('RATE_LIMITED', 'Rate limited', { status: 429 }) });
    const res = await newSync(db, errClient).tick();
    assert.equal(res.skipped, 'upstream-error');
    assert.equal(res.error, 'RATE_LIMITED');

    // the price SURVIVES untouched (observed at the same instant, still within the
    // TTL). The point of this test is the honest-degrade contract: never wipe the
    // market, never fabricate a replacement number. (markStale's TTL flip is covered
    // separately in the next test.)
    const { rows } = await db.query(`select price_source, yes_price from markets where source='panta'`);
    assert.equal(rows.length, 1, 'market never wiped on upstream failure');
    assert.equal(Number(rows[0].yes_price), 0.62, 'last-known price kept');
    assert.equal(rows[0].price_source, 'panta_live', 'a still-fresh price is not falsely marked stale');
  });

  it('markStale flips only OLD panta_live prices to stale_panta (TTL honored)', async () => {
    const { db } = await makeApp();
    await db.query(
      `insert into users(id, wallet, display_name) values($1,$2,$3) on conflict (id) do nothing`,
      [PANTA_SYNC_USER.id, PANTA_SYNC_USER.wallet, PANTA_SYNC_USER.displayName],
    );
    const base = { creator: PANTA_SYNC_USER.id };
    // fresh price: observed at T0 (within the 60s TTL) → stays panta_live
    await db.query(
      `insert into markets(id, creator_id, source, panta_market_id, question, resolution_rule, sources_of_truth, category,
          start_time, end_time, resolution_time, price_source, price_observed_at)
         values($1,$2,'panta','fresh-q','Fresh question about a market?','r',ARRAY['s'],'Crypto',$3,$4,$5,'panta_live',$6)`,
      [randomUUID(), base.creator, new Date(T0).toISOString(), new Date(T0).toISOString(), new Date(T0).toISOString(), new Date(T0).toISOString()],
    );
    // old price: observed 2 minutes ago (past the 60s TTL) → should flip to stale
    await db.query(
      `insert into markets(id, creator_id, source, panta_market_id, question, resolution_rule, sources_of_truth, category,
          start_time, end_time, resolution_time, price_source, price_observed_at)
         values($1,$2,'panta','old-q','Old question about a market here?','r',ARRAY['s'],'Crypto',$3,$4,$5,'panta_live',$6)`,
      [randomUUID(), base.creator, new Date(T0).toISOString(), new Date(T0).toISOString(), new Date(T0).toISOString(), new Date(T0 - 120000).toISOString()],
    );
    const s = newSync(db, fakeClient([]));
    const n = await s.markStale();
    assert.equal(n, 1, 'exactly the stale market flipped');
    const { rows } = await db.query(`select panta_market_id, price_source from markets where panta_market_id in ('fresh-q','old-q')`);
    const byId = Object.fromEntries(rows.map((r) => [r.panta_market_id, r.price_source]));
    assert.equal(byId['fresh-q'], 'panta_live', 'fresh price is NOT marked stale');
    assert.equal(byId['old-q'], 'stale_panta', 'old price IS marked stale');
  });

  it('BUDGET: at the read cap → skip, client NOT called', async () => {
    const { db } = await makeApp();
    const c = fakeClient([pantaRow()]);
    const s = newSync(db, c, null, { defaults: { readBudgetPerWindow: 0 } });
    const res = await s.tick();
    assert.equal(res.skipped, 'budget');
    assert.equal(c.calls, 0);
  });

  it('PRIMARY-PHASE FIRST + importLimit: caps surfaced markets per tick', async () => {
    const { db } = await makeApp();
    const rows = [];
    for (let i = 0; i < 5; i += 1) rows.push(pantaRow({ marketId: `sec-${i}`, phase: 'secondary', question: `Secondary market question number ${i}?` }));
    rows.unshift(pantaRow({ marketId: 'pri-1', phase: 'primary', question: 'The single primary market question here?' }));
    const s = newSync(db, fakeClient(rows), null, { defaults: { importLimit: 2 } });
    const res = await s.tick();
    assert.equal(res.imported + res.updated, 2, 'importLimit honored');
    const { rows: mk } = await db.query(`select panta_market_id from markets where source='panta' order by created_at`);
    assert.equal(mk[0].panta_market_id, 'pri-1', 'primary phase is imported first');
  });

  it('a row with no readable question is skipped, never inserted', async () => {
    const { db } = await makeApp();
    const res = await newSync(db, fakeClient([{ marketId: 'x', phase: 'primary', yesPrice: '0.5' }])).tick();
    assert.equal(res.imported, 0);
    const { rows } = await db.query(`select count(*)::int c from markets where source='panta'`);
    assert.equal(rows[0].c, 0);
  });

  it('start()/stop() schedule an unref\'d poll interval and clear it', async () => {
    const { db } = await makeApp();
    let scheduled = null;
    let cleared = false;
    const s = createPantaSync({
      db,
      liveClient: fakeClient([], { throws: new PantaError('UPSTREAM_UNAVAILABLE', 'down', { status: 502 }) }),
      env: {},
      enabled: true,
      now,
      warn: () => {},
      setIntervalImpl: (fn, ms) => { scheduled = { fn, ms }; return { unref() {} }; },
      clearIntervalImpl: () => { cleared = true; },
    });
    s.start();
    assert.ok(scheduled, 'start() schedules a poll');
    assert.equal(scheduled.ms, PANTA_SYNC_DEFAULTS.pollIntervalMs);
    s.stop();
    assert.equal(cleared, true);
  });
});
