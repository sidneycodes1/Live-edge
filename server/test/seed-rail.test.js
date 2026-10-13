import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';
import { seed } from '../src/db/seed.js';

describe('Seed fallback rail & rooms visibility (JOB 1)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('fresh boot with seed returns >=2 honest markets, open with future end_time, resilient to auto-close', async () => {
    const { db, fetchJson } = await makeApp();
    await seed(db);

    // Call 1: markets rail
    const { json: m1 } = await fetchJson('/api/markets?rail=trending');
    assert.ok(m1.items.length >= 2, 'rail returns >= 2 markets on fresh seeded boot');
    const now = Date.now();
    for (const m of m1.items) {
      assert.equal(m.status, 'open', 'seed market is open');
      assert.equal(m.is_seed, true, 'is_seed is true');
      assert.equal(m.demo, true, 'demo is true');
      const endMs = new Date(m.end_time).getTime();
      assert.ok(endMs > now + 86400000, 'end_time is > now + 1d');
    }

    // Run the auto-close query manually to simulate a background tick / read-path pass
    await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);

    // Call 2: second request still returns them open
    const { json: m2 } = await fetchJson('/api/markets?rail=trending');
    assert.equal(m2.items.length, m1.items.length, 'auto-close did not eat the seed markets');

    // Call 3: GET /api/rooms returns the seeded rooms carrying their open hero markets
    const { json: rooms } = await fetchJson('/api/rooms');
    assert.ok(rooms.length >= 2, 'GET /api/rooms returns >= 2 seeded rooms with open hero markets');
    for (const room of rooms) {
      assert.ok(room.heroMarket, 'room has hero market');
      assert.equal(room.heroMarket.status, 'open', 'hero market is open');
      assert.equal(room.heroMarket.isSeed, true, 'hero market is flagged seed');
    }
  });

  it('ordering places non-seed rooms before seed rooms in GET /api/rooms', async () => {
    const { db, fetchJson } = await makeApp();
    await seed(db);

    // Create a live user room with an open market
    const uid = randomUUID();
    const roomId = randomUUID();
    const marketId = randomUUID();
    await db.query(`insert into users(id, wallet, display_name) values($1,$2,'LiveCreator')`, [uid, 'LiveCreatorWallet']);
    await db.query(
      `insert into rooms(id, owner_id, title, status, is_seed) values($1,$2,'Live Stream Room','live',false)`,
      [roomId, uid],
    );
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, start_time, end_time, resolution_time, yes_price, no_price, prior_yes, volume, status, is_seed)
       values($1,$2,$3,'sim','Will the creator win today?','rule',ARRAY['s'],'gaming',now(),'2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',0.5,0.5,0.5,0,'open',false)`,
      [marketId, roomId, uid],
    );

    const { json: rooms } = await fetchJson('/api/rooms');
    assert.ok(rooms.length >= 3, 'rooms includes user room and seed rooms');
    assert.equal(rooms[0].id, roomId, 'non-seed room ranks first');
    assert.equal(rooms[0].isSeed, false, 'first room is not seed');
    const remaining = rooms.slice(1);
    for (const r of remaining) {
      assert.equal(r.isSeed, true, 'subsequent rooms are seed fallback');
    }
  });

  it('seed is idempotent: running twice does not throw or duplicate', async () => {
    const { db } = await makeApp();
    await seed(db);
    // run again
    await assert.doesNotReject(async () => {
      await seed(db);
    }, 'seed is idempotent');
    const { rows: rCount } = await db.query('select count(*) as c from rooms');
    assert.equal(Number(rCount[0].c), 2, 'exact 2 rooms');
    const { rows: mCount } = await db.query('select count(*) as c from markets');
    assert.equal(Number(mCount[0].c), 2, 'exact 2 markets');
  });
});
