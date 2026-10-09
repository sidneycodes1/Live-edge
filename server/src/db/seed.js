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
const MARKETS = {
  gamingMalenia: 'beef0000-0000-4000-8000-000000000013',
  gamingSpeedrun: 'beef0000-0000-4000-8000-000000000014',
  lifestyleSketch: 'beef0000-0000-4000-8000-000000000015',
};

// --- fixed time horizon (absolute, deterministic) ----------------------------
const START = '2024-01-01T00:00:00.000Z'; // market opened (fixed past)
const END = '2099-12-31T00:00:00.000Z'; // fixed far future → stays 'open' at read time
const RESOLVE = '2099-12-31T01:00:00.000Z'; // after end, fixed

// Every market resolves on the existing sim/hybrid (demo settlement) path — we do
// not fabricate an oracle. This descriptor is honest text, not a URL that could 404.
const SIM_SOURCE = ['sim (demo settlement — honest label, no real oracle yet)'];

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

  // --- markets: open across gaming + lifestyle ------------------------------
  const markets = [
    {
      id: MARKETS.gamingMalenia,
      room: ROOMS.gaming,
      creator: USERS.owner,
      category: 'gaming',
      q: 'Will he beat Malenia first try?',
      rule: 'YES if the boss is defeated on the first attempt, else NO',
    },
    {
      id: MARKETS.gamingSpeedrun,
      room: ROOMS.gaming,
      creator: USERS.owner,
      category: 'gaming',
      q: 'Will the run finish under 30 minutes?',
      rule: 'YES if the run timer is under 30:00, else NO',
    },
    {
      id: MARKETS.lifestyleSketch,
      room: ROOMS.lifestyle,
      creator: USERS.viewer,
      category: 'lifestyle',
      q: 'Will the sketch be finished before the stream ends?',
      rule: 'YES if the drawing is completed and posted, else NO',
    },
  ];
  for (const m of markets) {
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, image_url, start_time, end_time, resolution_time, yes_price, no_price, volume, status, is_seed)
       values($1,$2,$3,'sim',$4,$5,$6,$7,$8,$9,$10,$11,0.5,0.5,0,'open',true)`,
      [m.id, m.room, m.creator, m.q, m.rule, SIM_SOURCE, m.category, null, START, END, RESOLVE],
    );
    await db.query(
      `insert into chat_messages(room_id, user_id, kind, body, is_seed) values($1,$2,'system',$3,true)`,
      [m.room, m.creator, `New market just dropped: ${m.q}`],
    );
  }

  await db.query(
    `insert into chat_messages(room_id, user_id, kind, body, is_seed) values($1,$2,'chat',$3,true)`,
    [ROOMS.gaming, USERS.viewer, "let's go!"],
  );
}
