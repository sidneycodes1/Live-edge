import { randomUUID } from 'node:crypto';

export async function seed(db, { fallbackChannel } = {}) {
  const { rows: existing } = await db.query('select count(*) as c from rooms');
  if (Number(existing[0].c) > 0) return;

  // create seed users
  const u1 = randomUUID();
  const u2 = randomUUID();
  await db.query(`insert into users(id, wallet, display_name) values($1,$2,$3) on conflict do nothing`, [u1, 'SeedOwner111111111111111111111111111111', 'StreamerSeed']);
  await db.query(`insert into users(id, wallet, display_name) values($1,$2,$3) on conflict do nothing`, [u2, 'SeedViewer222222222222222222222222222222', 'ViewerSeed']);
  await db.query(`insert into balances(user_id, sim_usdc) values($1, 100) on conflict do nothing`, [u1]);
  await db.query(`insert into balances(user_id, sim_usdc) values($1, 100) on conflict do nothing`, [u2]);

  const r1 = randomUUID();
  const r2 = randomUUID();
  // r1 optionally becomes the guaranteed "always-live" demo room: when a reliable
  // 24/7 channel is configured (TWITCH_FALLBACK_CHANNEL) we bind it so judges always
  // have one real video+chat+market room. Embeds don't need API creds; if unset, this
  // stays a normal simulated room (we never fake a live channel).
  const ch1 = (fallbackChannel || '').trim().toLowerCase() || null;
  await db.query(`insert into rooms(id, owner_id, title, video_url, twitch_channel, status, is_seed) values($1,$2,$3,$4,$5,'live',true)`, [r1, u1, 'Elder Ring - First Try Malenia', 'https://example.com/stream1', ch1]);
  await db.query(`insert into rooms(id, owner_id, title, video_url, status, is_seed) values($1,$2,$3,$4,'live',true)`, [r2, u2, 'Speedrun: Any% in 30 min?', 'https://example.com/stream2']);

  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + 60 * 60000).toISOString();
  const res = new Date(now.getTime() + 65 * 60000).toISOString();

  const markets = [
    { q: 'Will he beat Malenia first try?', rule: 'YES if boss defeated first attempt, else NO', room: r1 },
    { q: 'Will the run finish under 30 minutes?', rule: 'YES if timer <30:00, else NO', room: r2 },
    { q: 'Will chat\'s pick win the next match?', rule: 'YES if chat pick wins, else NO', room: r1 },
  ];
  for (const m of markets) {
    const mid = randomUUID();
    await db.query(
      `insert into markets(id, room_id, creator_id, source, question, resolution_rule, sources_of_truth, category, image_url, start_time, end_time, resolution_time, yes_price, no_price, volume, status, is_seed)
       values($1,$2,$3,'sim',$4,$5,$6,'gaming',$7,$8,$9,$10,0.5,0.5,0,'open',true)`,
      [mid, m.room, u1, m.q, m.rule, ['https://example.com/stream'], `https://via.placeholder.com/1024?text=${encodeURIComponent(m.q.slice(0,20))}`, start, end, res],
    );
    await db.query(`insert into chat_messages(room_id, user_id, kind, body, is_seed) values($1,$2,'system',$3,true)`, [m.room, u1, `New market just dropped: ${m.q}`]);
  }
  await db.query(`insert into chat_messages(room_id, user_id, kind, body, is_seed) values($1,$2,'chat',$3,true)`, [r1, u2, 'let\'s go!']);
}
