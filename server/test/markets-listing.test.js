import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';
import { ENGINE_USER } from '../src/services/marketEngine.js';

// TASK 3 — the public markets listing / rails (GET /api/markets) and its ordering:
//   * markets with REAL user activity (buy trades > 0) lead,
//   * sim-engine filler ranks LAST inside the no-activity tier,
//   * legacy seed markets (is_seed) are excluded from every rail (opt back via ?includeSeed=1),
//   * sim-engine rows expose the broadcast-tie `engine` object; every other row `null`.
// Fixed far-future clock so the read-path auto-close (real DB clock) never flips our
// seeded open markets closed mid-assertion.
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const FAR = Date.UTC(2099, 0, 1);

async function ensureUser(db) {
  await db.query(`insert into users(id, wallet, display_name) values($1,$2,$3) on conflict (id) do nothing`, [
    ENGINE_USER.id,
    ENGINE_USER.wallet,
    ENGINE_USER.displayName,
  ]);
}

async function seedMarket(db, { source = 'sim-engine', question, status = 'open', endMs = FAR, isSeed = false, image = null, engine = {} }) {
  await ensureUser(db);
  const id = randomUUID();
  await db.query(
    `insert into markets(id, creator_id, source, question, resolution_rule, sources_of_truth, category, image_url,
        start_time, end_time, resolution_time, status, is_seed, engine_live_item_id, engine_video_id, engine_channel_slug, engine_watch_url)
       values($1,$2,$3,$4,'rule',ARRAY['src'],'News',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, ENGINE_USER.id, source, question, image, new Date(T0 - 60000).toISOString(), new Date(endMs).toISOString(), new Date(endMs + 300000).toISOString(), status, isSeed, engine.liveItemId || null, engine.videoId || null, engine.channelSlug || null, engine.watchUrl || null],
  );
  return id;
}

async function addBuyTrade(db, marketId, userId) {
  await db.query(
    `insert into trades(id, user_id, market_id, kind, side, amount, shares, signature) values($1,$2,$3,'buy','yes',10,10,$4)`,
    [randomUUID(), userId, marketId, randomUUID()],
  );
}

describe('GET /api/markets (listing + TASK 3 ordering)', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('real-activity markets rank above sim-engine filler; legacy seeds are excluded', async () => {
    const { db, fetchJson } = await makeApp();
    const realId = await seedMarket(db, { source: 'sim', question: 'A real user market with a bet on it?', isSeed: false });
    await seedMarket(db, { source: 'sim-engine', question: 'A fresh engine market about a live stream?' });
    const seedId = await seedMarket(db, { source: 'sim', question: 'Legacy 2024 seed demo market here?', isSeed: true });
    // a user + a buy trade on the real market → bets>0
    const uid = randomUUID();
    await db.query(`insert into users(id, wallet, display_name) values($1,$2,'Tester')`, [uid, 'TesterWallet' + uid]);
    await addBuyTrade(db, realId, uid);

    const { json } = await fetchJson('/api/markets?rail=trending');
    const ids = json.items.map((m) => m.id);
    assert.ok(!ids.includes(seedId), 'legacy seed excluded from trending rail');
    assert.equal(ids[0], realId, 'the bet-backed market leads the rail');
    const engine = json.items.find((m) => m.source === 'sim-engine');
    assert.ok(engine, 'engine market still listed (just not first)');
    assert.ok(engine.bets >= 0);
  });

  it('sim-engine rows expose the broadcast-tie `engine` object; others are null', async () => {
    const { db, fetchJson } = await makeApp();
    await seedMarket(db, {
      source: 'sim-engine',
      question: 'Engine market tied to a real stream?',
      image: 'https://i.ytimg.com/vi/vid1/hqdefault.jpg',
      engine: { liveItemId: 'yt-vid1', videoId: 'vid1', channelSlug: 'aljazeera', watchUrl: 'https://youtu.be/vid1' },
    });
    await seedMarket(db, { source: 'sim', question: 'A plain sim market for contrast?' });
    const { json } = await fetchJson('/api/markets?rail=all&includeSeed=1');
    const eng = json.items.find((m) => m.source === 'sim-engine');
    assert.deepEqual(eng.engine, { live_item_id: 'yt-vid1', video_id: 'vid1', channel_slug: 'aljazeera', watch_url: 'https://youtu.be/vid1' });
    assert.equal(eng.image_url, 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
    const plain = json.items.find((m) => m.source === 'sim');
    assert.equal(plain.engine, null);
  });

  it('closing rail sorts by soonest end_time and only serves open markets', async () => {
    const { db, fetchJson } = await makeApp();
    const farId = await seedMarket(db, { source: 'sim-engine', question: 'A far future closing candidate?', endMs: FAR + 25 * 60 * 1000 });
    const soonId = await seedMarket(db, { source: 'sim-engine', question: 'A soon closing candidate market?', endMs: FAR + 5 * 60 * 1000 });
    await seedMarket(db, { source: 'sim-engine', question: 'Already closed engine market here?', status: 'closed' });
    const { json } = await fetchJson('/api/markets?rail=closing');
    const ids = json.items.map((m) => m.id);
    assert.ok(!ids.includes(json.items.find((m) => m.status === 'closed')?.id), 'no closed markets in closing rail');
    assert.equal(ids[0], soonId, 'soonest end_time first');
    assert.ok(ids.includes(farId));
  });
});
