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
       values($1,$2,$3,$4,$5,'live',true,$6,$7)
       on conflict (id) do nothing`,
      [room.id, room.owner, room.title, room.video_url, room.kick_channel, room.category, room.source],
    );
  }

  // --- markets: honest simulated starter rail -------------------------------
  // A fresh DB starts with rooms plus clearly-labelled simulated markets.
  // This gives a first visitor a usable rail without claiming that a live broadcast
  // or external price generated the question. The engine later adds its own live-tied markets.
  const far = '2099-01-01T00:00:00.000Z';
  const starts = '2026-01-01T00:00:00.000Z';
  const demoMarkets = [
    ['33333333-3333-4333-8333-333333333333', ROOMS.gaming, 'Will the player complete the next boss attempt?', 'Resolved by the room host after the attempt.', 'gaming', 0.58],
    ['44444444-4444-4444-8444-444444444444', ROOMS.lifestyle, 'Will the sketch use more than three colors?', 'Resolved from the completed stream segment.', 'lifestyle', 0.42],
  ];
  for (const [id, roomId, question, rule, category, yes] of demoMarkets) {
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, start_time, end_time, resolution_time, yes_price, no_price, prior_yes, volume, status, is_seed)
       values($1,$2,$3,'sim',$4,$5,ARRAY['demo:seeded-simulated'], $6,$7,$8,$9,$10,$11,$12,0,'open',true)
       on conflict (id) do nothing`,
      [id, roomId, USERS.owner, question, rule, category, starts, far, far, yes, 1 - yes, yes],
    );
  }

  const { rows: existingChat } = await db.query('select 1 from chat_messages where is_seed = true limit 1');
  if (existingChat.length === 0) {
    await db.query(
      `insert into chat_messages(room_id, user_id, kind, body, is_seed) values($1,$2,'chat',$3,true)`,
      [ROOMS.gaming, USERS.viewer, "let's go!"],
    );
  }
}
