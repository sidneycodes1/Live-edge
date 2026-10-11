// Deterministic seed for a fresh database.
//
// Design rules (frozen contract docs/live-aggregation-spec.md §2, §4, §9 — Agent C):
//  - FIXED ids (no randomUUID): a fresh DB is byte-for-byte reproducible so E2E is
//    deterministic and cross-agent fixtures can reference stable ids.
//  - FIXED absolute timestamps, never `new Date()`-relative: markets are seeded
//    `open` with an end_time far in the future, so the read-path auto-close
//    (`end_time <= now()` in routes/rooms.js) can never flip them closed at an
//    arbitrary test time. This removes all time-based nondeterminism.
//  - HONEST shapes only: no `via.placeholder.com`, no fabricated stream URLs.
//    `image_url`/`video_url` are null → the frontend renders its neutral "no
//    preview"/animated-mock states (see LiveThumb.jsx / VideoStage.jsx).
//  - category + real-vs-demo are stored as queryable room facts (migration 007).
//    A room is `real` ONLY when a genuine channel is bound.
//  - The football watch-party room was removed (Oct 2026) with the whole
//    API-Football vertical; the `watch_party` column still exists in the schema,
//    it is simply never set true by the seed anymore.

// --- fixed ids ---------------------------------------------------------------
const USERS = {
  owner: '11111111-1111-4111-8111-111111111111',
  viewer: '22222222-2222-4222-8222-222222222222',
};
const ROOMS = {
  gaming: 'cafe0000-0000-4000-8000-000000000002',
  lifestyle: 'cafe0000-0000-4000-8000-000000000003',
};

// No markets are seeded (owner decision, Oct 2026) — every bet is engine-born from a
// live broadcast, so there is no fixed market id / time horizon / demo source here.

export async function seed(db, { fallbackChannel } = {}) {
  const { rows: existing } = await db.query('select count(*) as c from rooms');
  if (Number(existing[0].c) > 0) return;

  // When a reliable 24/7 channel is configured (KICK_FALLBACK_CHANNEL) we bind it
  // to the gaming room so the "always-live" room is genuinely real. Embeds don't
  // need API creds. If unset, the room stays an honest `demo` room — we NEVER fake
  // a live channel (§4), so `source` reflects the binding, not wishful labeling.
  const ch1 = (fallbackChannel || '').trim().toLowerCase() || null;
  const gamingSource = ch1 ? 'real' : 'demo';

  // --- users + balances ------------------------------------------------------
  await db.query(
    `insert into users(id, wallet, display_name) values($1,$2,$3) on conflict do nothing`,
    [USERS.owner, 'SeedOwner111111111111111111111111111111', 'StreamerSeed'],
  );
  await db.query(
    `insert into users(id, wallet, display_name) values($1,$2,$3) on conflict do nothing`,
    [USERS.viewer, 'SeedViewer222222222222222222222222222222', 'ViewerSeed'],
  );
  await db.query(`insert into balances(user_id, sim_usdc) values($1, 100) on conflict do nothing`, [USERS.owner]);
  await db.query(`insert into balances(user_id, sim_usdc) values($1, 100) on conflict do nothing`, [USERS.viewer]);

  // --- rooms: queryable category / real-vs-demo facts ---------------------
  const rooms = [
    {
      id: ROOMS.gaming,
      owner: USERS.owner,
      title: 'Elder Ring - First Try Malenia',
      video_url: null, // animated demo mock unless a real channel is bound
      kick_channel: ch1,
      category: 'gaming',
      source: gamingSource,
    },
    {
      id: ROOMS.lifestyle,
      owner: USERS.viewer,
      title: 'Sunrise Sketch & Chat',
      video_url: null,
      kick_channel: null,
      category: 'lifestyle',
      source: 'demo',
    },
  ];
  for (const room of rooms) {
    await db.query(
      `insert into rooms(id, owner_id, title, video_url, kick_channel, status, is_seed, category, source)
       values($1,$2,$3,$4,$5,'live',true,$6,$7)`,
      [room.id, room.owner, room.title, room.video_url, room.kick_channel, room.category, room.source],
    );
  }

  // --- markets: NONE seeded (owner decision, Oct 2026) ----------------------
  // The demo bet questions ("Will he beat Malenia first try?", etc.) are retired:
  // every bet the app shows must be BORN FROM A LIVE BROADCAST via the market
  // engine (source='sim-engine'), never a static seed row. A fresh DB therefore
  // starts with rooms + users but ZERO markets, and the engine fills the rails with
  // real, rotating, live-tied bets. (Existing seed rows in an already-seeded DB are
  // hidden from the rooms list by the is_seed filter in routes/rooms.js — never
  // deleted, so any historical trades/ledger stay queryable.)

  await db.query(
    `insert into chat_messages(room_id, user_id, kind, body, is_seed) values($1,$2,'chat',$3,true)`,
    [ROOMS.gaming, USERS.viewer, "let's go!"],
  );
}
