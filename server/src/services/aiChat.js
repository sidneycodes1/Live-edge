import { sanitizeText } from './sanitize.js';

// ---------------------------------------------------------------------------
// AI spectator chat (services/aiChat.js) — the "no dead rooms" feature.
//
// Honesty contract (UI honesty rules):
//   • Every message is stored kind='ai' with a synthetic persona name and the
//     web renders an "AI" badge. Nobody can mistake it for a human.
//   • Lines comment ONLY on the market surface we can actually see (odds, the
//     countdown clock, betting vibe). They NEVER claim to have observed the
//     stream itself — we cannot see it, so we never describe it.
//   • Only rooms WITHOUT a real chat surface are eligible: a room whose video
//     is a YouTube/Twitch embed already carries the provider's live chat iframe
//     (WatchRoom), and simulated spectators must not talk over real people.
//   • Nothing is posted into an empty room: a message only fires while the SSE
//     hub reports at least one connected viewer.
//
// Runner pattern mirrors services/marketEngine.js: injectable now/timers/rng,
// start()/stop(), disable-safe (AI_SPECTATOR=off → no ticks, no writes).
// ---------------------------------------------------------------------------

export const AI_DEFAULTS = {
  tickMs: 20000, // how often we consider posting
  perRoomEveryMs: 45000, // min gap between two spectator lines in the SAME room
  maxRoomsPerTick: 3, // global throttle so the vibe stays relaxed
};

// Deliberately synthetic-sounding names (no attempt to pass as human handles).
export const PERSONAS = [
  'Spectra-7', 'Odds-Owl', 'Quiet Fox', 'Market Moth',
  'Backrow Bot', 'Tape Reader', 'Sideline Sam',
];

function pick(rng, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

// One line of spectator chatter for an open market row. Pure + injectable rng
// so tests are deterministic. `now` (ms) makes the countdown math testable.
export function spectatorLine(rng, m) {
  const yes = Math.round(Number(m.yesPrice) * 100);
  const no = 100 - yes;
  const minsLeft = Math.max(1, Math.round((new Date(m.endTime).getTime() - m.now) / 60000));
  const templates = [
    () => `${yes}% YES on the board and the clock says ${minsLeft}m — someone do something`,
    () => `Watching ${no}% NO hold steady like it's paying rent`,
    () => `${minsLeft} minutes left. The line has moved zero times. Peak tension`,
    () => `I came for the stream and stayed for the odds bar`,
    () => `Simulated play on YES for $5. Don't take tips from a labelled bot`,
    () => `Volume: ${m.volume ?? 0}. Company: ${yes > 60 || yes < 40 ? 'plenty of opinions' : 'an even split of stubborn'}`,
    () => `This countdown is the main character`,
  ];
  return pick(rng, templates)();
}

export function createAiSpectator({
  db,
  hub,
  env = {},
  now = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  warn = (msg) => console.warn(msg),
  rng = Math.random,
} = {}) {
  const cfg = { ...AI_DEFAULTS };
  const enabled = env.AI_SPECTATOR !== 'off';
  let timer = null;
  // In-memory per-room throttle. A restart just replays harmlessly (worst case a
  // room waits one interval before its next line) — no DB state needed.
  const lastAt = new Map();

  // Live rooms with an OPEN market and NO real-chat embed (no YouTube/Twitch
  // video_url). Newest market wins per room (ORDER BY created_at DESC + dedupe).
  async function candidates() {
    const { rows } = await db.query(
      `select r.id as room_id, m.id as market_id, m.question, m.yes_price, m.end_time, m.volume
       from rooms r
       join markets m on m.room_id = r.id and m.status = 'open'
       where r.status = 'live'
         and (r.video_url is null
              or (r.video_url not ilike '%youtube.com%' and r.video_url not ilike '%twitch.tv%'))
       order by m.created_at desc`,
    );
    const byRoom = new Map();
    for (const row of rows) if (!byRoom.has(row.room_id)) byRoom.set(row.room_id, row);
    return [...byRoom.values()];
  }

  async function tick() {
    if (!enabled) return { skipped: 'disabled' };
    const t = now();
    const list = await candidates();
    let sent = 0;
    for (const row of list) {
      if (sent >= cfg.maxRoomsPerTick) break;
      if (!hub || hub.count(row.room_id) === 0) continue; // never preach to an empty room
      if (t - (lastAt.get(row.room_id) ?? 0) < cfg.perRoomEveryMs) continue;
      const name = pick(rng, PERSONAS);
      const body = sanitizeText(
        spectatorLine(rng, { yesPrice: row.yes_price, endTime: row.end_time, volume: row.volume, now: t }),
      ).slice(0, 280);
      const { rows } = await db.query(
        `insert into chat_messages(room_id, user_id, kind, body, display_name)
         values($1, null, 'ai', $2, $3) returning id, created_at`,
        [row.room_id, body, name],
      );
      const msg = rows[0];
      hub.broadcast(row.room_id, 'chat', { id: msg.id, kind: 'ai', name, body, ts: msg.created_at });
      lastAt.set(row.room_id, t);
      sent += 1;
    }
    return { sent, considered: list.length };
  }

  function start() {
    if (!enabled || timer) return;
    timer = setIntervalImpl(() => {
      tick().catch((e) => warn(`aiSpectator tick failed (${e.code || e.name})`));
    }, cfg.tickMs);
    if (timer?.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearIntervalImpl(timer);
      timer = null;
    }
  }

  return { tick, start, stop, isEnabled: () => enabled, _cfg: cfg };
}
