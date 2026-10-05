import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv, resetDb, makeApp } from './helpers/testApp.js';
import { createAiSpectator, spectatorLine, PERSONAS, AI_DEFAULTS } from '../src/services/aiChat.js';

// AI spectator chat (services/aiChat.js). Honesty contract under test:
//   • rows are stored kind='ai' with a persona display_name;
//   • nothing posts while the hub reports zero viewers;
//   • rooms whose video_url is a YouTube/Twitch embed (real chat surface) are
//     NEVER eligible — verified against the REAL schema here, not just a fake;
//   • AI_SPECTATOR=off writes nothing at all.
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const FAR = Date.UTC(2099, 0, 1);
const now = () => T0;
const rngZero = () => 0; // deterministic: first persona, first template

function fakeHub(count = 1) {
  const bc = [];
  return {
    count: () => count,
    broadcast: (roomId, type, payload) => bc.push({ roomId, type, payload }),
    bc,
  };
}

async function seedRoomWithMarket(db, { videoUrl = null, status = 'live', question = 'Will this countdown beat on time at all?' }) {
  const uid = randomUUID();
  await db.query(`insert into users(id, wallet, display_name) values($1,$2,'Streamer')`, [uid, 'Wallet' + uid]);
  const roomId = randomUUID();
  await db.query(`insert into rooms(id, owner_id, title, video_url, status, is_seed) values($1,$2,'Spectator Test Room',$3,$4,false)`, [
    roomId, uid, videoUrl, status,
  ]);
  await db.query(
    `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, start_time, end_time, resolution_time, status, is_seed)
     values($1,$2,$3,'sim',$4,'rule',ARRAY['src'],'News',$5,$6,$7,'open',false)`,
    [randomUUID(), roomId, uid, question, new Date(T0 - 60000).toISOString(), new Date(FAR).toISOString(), new Date(FAR + 300000).toISOString()],
  );
  return roomId;
}

describe('aiChat/spectatorLine (pure)', () => {
  it('is deterministic for a fixed rng and stays within the 280-char budget', () => {
    const m = { yesPrice: 0.55, endTime: new Date(T0 + 10 * 60000).toISOString(), volume: 42, now: T0 };
    const a = spectatorLine(rngZero, m);
    const b = spectatorLine(rngZero, m);
    assert.equal(a, b);
    assert.ok(a.length <= 280, `line too long: ${a.length}`);
    assert.ok(a.includes('55'), 'comments on the visible odds');
  });
  it('never claims to have seen the stream (honesty: market surface only)', () => {
    const m = { yesPrice: 0.5, endTime: new Date(T0 + 10 * 60000).toISOString(), volume: 0, now: T0 };
    for (let i = 0; i < 20; i += 1) {
      const line = spectatorLine(() => i / 20, m);
      assert.ok(line.length > 0 && line.length <= 280);
      // the one template that mentions "stream" explicitly frames it as "came for
      // the stream and stayed for the odds" — no observational claims like "see how..."
      assert.ok(!/right now on screen|i can see|look at (that|the) player/i.test(line), line);
    }
  });
});

describe('aiSpectator runner (hermetic fakes)', () => {
  it('AI_SPECTATOR=off → skipped, zero db touches', async () => {
    let queries = 0;
    const db = { query: async () => { queries += 1; return { rows: [] }; } };
    const spec = createAiSpectator({ db, hub: fakeHub(1), env: { AI_SPECTATOR: 'off' }, now, rng: rngZero, warn: () => {} });
    const res = await spec.tick();
    assert.deepEqual(res, { skipped: 'disabled' });
    assert.equal(queries, 0);
    assert.equal(spec.isEnabled(), false);
  });
  it('no viewers (hub.count=0) → no write, no broadcast', async () => {
    let inserts = 0;
    const row = { room_id: 'r1', market_id: 'm1', question: 'q?', yes_price: 0.5, end_time: new Date(FAR).toISOString(), volume: 0 };
    const db = {
      query: async (sql) => {
        if (sql.trim().startsWith('select')) return { rows: [row] };
        inserts += 1;
        return { rows: [{ id: 1, created_at: new Date(T0).toISOString() }] };
      },
    };
    const hub = fakeHub(0);
    const spec = createAiSpectator({ db, hub, env: {}, now, rng: rngZero, warn: () => {} });
    const res = await spec.tick();
    assert.equal(res.sent, 0);
    assert.equal(inserts, 0);
    assert.equal(hub.bc.length, 0);
  });
  it('per-room throttle: same instant second tick sends nothing new', async () => {
    const row = { room_id: 'r1', market_id: 'm1', question: 'q?', yes_price: 0.5, end_time: new Date(FAR).toISOString(), volume: 0 };
    const db = {
      query: async (sql) => (sql.trim().startsWith('select') ? { rows: [row] } : { rows: [{ id: 1, created_at: new Date(T0).toISOString() }] }),
    };
    const spec = createAiSpectator({ db, hub: fakeHub(1), env: {}, now, rng: rngZero, warn: () => {} });
    const first = await spec.tick();
    const second = await spec.tick();
    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
  });
  it('respects maxRoomsPerTick across many rooms', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ room_id: `r${i}`, market_id: `m${i}`, question: 'q?', yes_price: 0.5, end_time: new Date(FAR).toISOString(), volume: 0 }));
    let n = 0;
    const db = {
      query: async (sql) => (sql.trim().startsWith('select') ? { rows } : { rows: [{ id: (n += 1), created_at: new Date(T0).toISOString() }] }),
    };
    const spec = createAiSpectator({ db, hub: fakeHub(1), env: {}, now, rng: rngZero, warn: () => {} });
    const res = await spec.tick();
    assert.equal(res.sent, AI_DEFAULTS.maxRoomsPerTick);
  });
});

describe('aiSpectator on the real schema', () => {
  before(setupTestEnv);
  beforeEach(resetDb);
  after(teardownTestEnv);

  it('posts one labeled ai row into the chat-less room and skips the YouTube room', async () => {
    const { db } = await makeApp();
    const plainRoom = await seedRoomWithMarket(db, { videoUrl: null });
    const ytRoom = await seedRoomWithMarket(db, { videoUrl: 'https://www.youtube.com/watch?v=abc123' });
    const twRoom = await seedRoomWithMarket(db, { videoUrl: 'https://www.twitch.tv/somechannel' });
    const hub = fakeHub(1);
    const spec = createAiSpectator({ db, hub, env: {}, now, rng: rngZero, warn: () => {} });
    const res = await spec.tick();

    assert.equal(res.sent, 1, 'only the room without a real chat surface is eligible');
    const { rows } = await db.query(`select kind, body, display_name, user_id, room_id from chat_messages`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'ai'); // widened CHECK (migration 009) accepts it
    assert.equal(rows[0].room_id, plainRoom);
    assert.equal(rows[0].user_id, null);
    assert.equal(rows[0].display_name, PERSONAS[0]);
    assert.ok(rows[0].body.length > 0);

    // SSE payload shape mirrors routes/chat.js (kind + name ride along)
    assert.equal(hub.bc.length, 1);
    assert.equal(hub.bc[0].roomId, plainRoom);
    assert.equal(hub.bc[0].type, 'chat');
    assert.equal(hub.bc[0].payload.kind, 'ai');
    assert.equal(hub.bc[0].payload.name, PERSONAS[0]);
    assert.ok([ytRoom, twRoom].every((r) => hub.bc.every((b) => b.roomId !== r)));
  });

  it('GET /api/rooms/:id surfaces the persona name via coalesce for ai rows', async () => {
    const { db, fetchJson } = await makeApp();
    const roomId = await seedRoomWithMarket(db, { videoUrl: null });
    await db.query(`insert into chat_messages(room_id, user_id, kind, body, display_name) values($1,null,'ai','the countdown is the main character','Odds-Owl')`, [roomId]);
    const { res, json } = await fetchJson(`/api/rooms/${roomId}`);
    assert.equal(res.status, 200);
    const ai = json.chat.find((c) => c.kind === 'ai');
    assert.ok(ai, 'ai message present in history');
    assert.equal(ai.user.display_name, 'Odds-Owl');
  });
});
