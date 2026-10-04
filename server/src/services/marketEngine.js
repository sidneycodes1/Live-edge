import { randomUUID } from 'node:crypto';
import { sanitizeText } from './sanitize.js';

// ---------------------------------------------------------------------------
// Broadcast-aligned market engine (Phase 2, server/src/services/marketEngine.js).
//
// THE USER'S CORE DEMAND: prediction markets must be BORN FROM WHAT IS LIVE RIGHT
// NOW — never an empty grid, and rotated ~every 30 minutes so tomorrow's app is not
// today's. Every rotation:
//   1. snapshot the CURRENT live grid (aggregator cache) + football fixtures,
//   2. ask Gemini for 3–5 short yes/no questions, EACH tied to a specific live item,
//   3. persist them as `source='sim-engine'` markets whose end_time is now + 30 min,
//      stamped with the stream's videoId / channelSlug / thumbnail so the web can show
//      "which stream this bet belongs to".
//
// It reuses the existing market row + LMSR shape (../panta/simClient.js registerMarket):
// a fresh market opens at q_yes=q_no=0 / yes_price=no_price=0.5 (the schema defaults),
// which IS the initial LMSR state at liquidity b=SIM_LIQUIDITY_B. Pricing is NOT
// reimplemented here — buying still flows through the existing sim/hybrid LMSR.
//
// Guards (all fail-safe, never crash boot):
//   * DISABLE-SAFE  — no Gemini key ⇒ tick returns {skipped:'disabled'} and the LAST
//                     batch stays served; existing markets are NEVER wiped.
//   * BUDGET        — ≤40 Gemini calls/day (memory mirror + DB, keyed by UTC day).
//                     Over budget ⇒ skip the tick, log ONE line, no call.
//   * ROTATION      — stop creating when ≥3 sim-engine markets are still open, so a
//                     30-min cadence can't stack unbounded. (A forced/dev tick may
//                     bypass ONLY this gate — see tick({force}).)
//   * DEDUP         — never two OPEN markets with the same question text.
//
// Runner style matches ../aggregator + ../curated: a pure factory with injectable
// `now` / `setIntervalImpl` / `clearIntervalImpl`, returning { tick, start, stop }.
// Tests (and the live proof) call tick() directly instead of waiting 30 minutes.
// ---------------------------------------------------------------------------

export const ENGINE_DEFAULTS = {
  rotationMs: 30 * 60 * 1000, // ~every 30 minutes
  marketTtlMs: 30 * 60 * 1000, // end_time = now + 30 min
  budgetPerDay: 40, // max Gemini calls/day
  maxOpenEngineMarkets: 3, // stop creating when >=3 sim-engine markets open
  marketsMin: 3, // per batch (from Gemini)
  marketsMax: 5,
  snapshotLimit: 24, // live items offered to the model
};

// Deterministic system creator for engine markets (markets.creator_id is NOT NULL).
// Fixed id + wallet, never secret; inserted on demand with ON CONFLICT DO NOTHING.
export const ENGINE_USER = {
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  wallet: 'EngineSystem00000000000000000000000000000001',
  displayName: 'LiveEdge Live Engine',
};

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

// Map a heterogeneous snapshot item (LiveChannel | curated item | football fixture)
// to the small "candidate" the prompt + insert need. Never fabricates: fields we don't
// have (thumbnail/videoId for football, etc.) stay null.
export function candidateFromItem(item, kind) {
  if (!item || item.id == null) return null;
  const liveItemId = String(item.id);
  if (!liveItemId) return null;
  let videoId = null;
  if (liveItemId.startsWith('yt-')) videoId = liveItemId.slice(3);
  else if (liveItemId.startsWith('youtube:')) videoId = liveItemId.slice(8);
  else if (typeof item.videoId === 'string') videoId = item.videoId;
  return {
    liveItemId,
    kind, // 'live' | 'football'
    videoId,
    channelSlug: item.channelSlug || item.owner || null,
    title: sanitizeText(item.title),
    channelName: sanitizeText(item.channelName || item.owner || item.league),
    category: sanitizeText(item.category),
    thumbnailUrl: item.thumbnailUrl || item.imageUrl || null,
    watchUrl: item.watchUrl || item.videoUrl || item.liveEmbedUrl || null,
  };
}

// The Gemini JSON contract: an object of markets, each naming the liveItemId it is
// about. responseMimeType=application/json + this schema steers machine-readable output.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    markets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          liveItemId: { type: 'STRING' },
          question: { type: 'STRING' },
          resolutionRule: { type: 'STRING' },
          category: { type: 'STRING' },
        },
        required: ['liveItemId', 'question'],
      },
    },
  },
  required: ['markets'],
};

function buildPrompt(candidates) {
  const lines = candidates.map(
    (c, i) => `${i + 1}. [${c.liveItemId}] (${c.category || c.kind}) "${c.title}" — ${c.channelName || 'channel'}`,
  );
  const n = candidates.length;
  return [
    'You write prediction-market questions for a LIVE-stream betting app.',
    'Below are streams that are LIVE RIGHT NOW. Produce between 3 and 5 questions,',
    'each about something genuinely resolvable about the specific stream it is tied to',
    '(what happens on THAT broadcast in the next ~30 minutes).',
    'Rules:',
    '  - Each item MUST set liveItemId to EXACTLY one id from the list (copy it verbatim).',
    '  - question: a single yes/no question, 8-140 characters, ending in "?".',
    '  - resolutionRule: one plain sentence stating how YES is decided.',
    '  - category: the stream category shown, or the sport for matches.',
    '  - Do not repeat a question. Do not reference streams not in the list.',
    'Return JSON only: { "markets": [ { "liveItemId", "question", "resolutionRule", "category" } ] }',
    '',
    `LIVE STREAMS (${n}):`,
    ...lines,
  ].join('\n');
}

// Clamp/sanitize a model question into the markets.question CHECK (8..140).
function normalizeQuestion(raw) {
  const q = sanitizeText(raw);
  if (q.length < 8) return null;
  return q.length > 140 ? q.slice(0, 140).trim() : q;
}

export function createMarketEngine(options = {}) {
  const {
    db,
    gemini,
    aggregator,
    env = {},
    defaults = {},
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    warn = (msg) => console.warn(msg),
  } = options;

  const cfg = { ...ENGINE_DEFAULTS, ...defaults };
  // Allow an env override for the daily budget without touching any other behavior.
  const budgetPerDay = Number(env.GEMINI_BUDGET_PER_DAY) || cfg.budgetPerDay;

  const state = {
    running: false,
    ticking: false,
    lastBatch: null, // last successful generation summary (kept for status/disabled path)
    lastError: null,
    budgetDay: null, // UTC day the in-memory counter applies to
    budgetCalls: 0, // in-memory mirror of engine_budget.calls for budgetDay
    totalCalls: 0, // lifetime successful generations (health/proof)
    totalCreated: 0,
  };
  let interval = null;

  async function ensureEngineUser() {
    await db.query(
      `insert into users(id, wallet, display_name) values($1,$2,$3) on conflict (id) do nothing`,
      [ENGINE_USER.id, ENGINE_USER.wallet, ENGINE_USER.displayName],
    );
  }

  // Authoritative per-day budget: read (and lazy-init) the DB row, mirroring it in
  // memory. A restart re-reads the persisted count so quota can't be re-spent.
  async function readBudget(day) {
    const { rows } = await db.query('select calls from engine_budget where day=$1', [day]);
    const calls = rows.length ? Number(rows[0].calls) : 0;
    state.budgetDay = day;
    state.budgetCalls = calls;
    return calls;
  }

  async function spendBudget(day) {
    if (state.budgetDay !== day) await readBudget(day);
    const next = state.budgetCalls + 1;
    await db.query(
      `insert into engine_budget(day, calls, updated_at) values($1, 1, now())
       on conflict (day) do update set calls = engine_budget.calls + 1, updated_at = now()`,
      [day],
    );
    state.budgetDay = day;
    state.budgetCalls = next;
    return next;
  }

  async function openEngineCount() {
    const { rows } = await db.query(
      `select count(*)::int as c from markets where source='sim-engine' and status='open'`,
    );
    return Number(rows[0]?.c || 0);
  }

  // Live grid (via aggregator's cache/ladder) + football fixtures, deduped by id.
  // BROADCAST RULE (user): a bet is born from a live BROADCAST — a candidate must
  // carry a real watchable stream (watchUrl + thumbnail). Football fixtures without
  // an attached broadcast are EXCLUDED here; their bets live in the match view.
  function isBroadcastCandidate(c) {
    return Boolean(c && c.watchUrl && c.thumbnailUrl);
  }

  async function snapshotCandidates() {
    const out = [];
    const seen = new Set();
    const push = (c) => {
      if (c && isBroadcastCandidate(c) && !seen.has(c.liveItemId)) {
        seen.add(c.liveItemId);
        out.push(c);
      }
    };
    if (typeof aggregator?.getChannels === 'function') {
      try {
        const agg = await aggregator.getChannels(cfg.snapshotLimit);
        for (const it of agg.items || []) push(candidateFromItem(it, 'live'));
      } catch (e) {
        warn(`marketEngine: live snapshot failed (${e.code || e.name})`);
      }
    }
    if (typeof aggregator?.getFootballMatches === 'function') {
      try {
        const fb = await aggregator.getFootballMatches(cfg.snapshotLimit);
        // Only fixtures that ALREADY carry a real broadcast (videoUrl) pass the
        // isBroadcastCandidate gate below — data-only fixtures are dropped.
        for (const it of fb.items || []) push(candidateFromItem(it, 'football'));
      } catch (e) {
        // Football disabled/empty is normal — never fatal to the engine.
        if (e.code !== 'DISABLED') warn(`marketEngine: football snapshot failed (${e.code || e.name})`);
      }
    }
    return out;
  }

  // Ask Gemini for a batch bound to real live items. Throws GeminiError on a real
  // upstream failure (the caller keeps the last batch instead of treating it as empty).
  async function generateBatch(candidates) {
    const raw = await gemini.generateJson(buildPrompt(candidates), {
      schema: RESPONSE_SCHEMA,
      systemInstruction: 'You are a precise JSON generator for live prediction markets. Output JSON only.',
      temperature: 0.8,
    });
    if (!raw) return []; // disabled client returns null (handled upstream too)
    const list = Array.isArray(raw?.markets) ? raw.markets : Array.isArray(raw) ? raw : [];
    const byId = new Map(candidates.map((c) => [c.liveItemId, c]));
    const out = [];
    for (const m of list) {
      const cand = byId.get(String(m?.liveItemId));
      if (!cand) continue; // ties to a stream NOT in the snapshot → drop (§4 honesty)
      const question = normalizeQuestion(m?.question);
      if (!question) continue;
      out.push({
        cand,
        question,
        resolutionRule: sanitizeText(m?.resolutionRule) || 'Resolved from the live broadcast named in the question.',
        category: sanitizeText(m?.category) || cand.category || cand.kind || 'gaming',
      });
    }
    return out.slice(0, cfg.marketsMax);
  }

  // B3 (lead patch): an engine market gets its OWN room so it is a first-class
  // citizen of /api/rooms — the Discover rails, the room page (real stream embed
  // via video_url + betting) and MarketCard's "in <stream>" context line all
  // consume rooms today, so this single change surfaces engine bets everywhere
  // with zero web changes. Title = the REAL stream title clamped to the rooms
  // CHECK (3..80); never a fabricated label. Closed batches are hidden by the
  // rooms list filter (routes/rooms.js), not deleted — trade/ledger rows stay.
  function engineRoomTitle(cand) {
    const t = sanitizeText(cand.title || cand.channelName || '').slice(0, 80).trim();
    return t.length >= 3 ? t : 'Live broadcast';
  }

  async function insertEngineMarket({ cand, question, resolutionRule, category }) {
    // Dedup: never two OPEN markets with the same question text (global, any creator).
    const { rows: dup } = await db.query(
      `select 1 from markets where status='open' and lower(question)=lower($1) limit 1`,
      [question],
    );
    if (dup.length > 0) return { skipped: 'dupe' };

    const id = randomUUID();
    const roomId = randomUUID();
    const start = new Date(now()).toISOString();
    const end = new Date(now() + cfg.marketTtlMs).toISOString();
    const resolution = new Date(now() + cfg.marketTtlMs + 5 * 60 * 1000).toISOString();
    // Sources of truth = the REAL stream the market is about (never a placeholder).
    const sourcesOfTruth = [cand.watchUrl || cand.liveItemId];
    await db.query(
      `insert into rooms(id, owner_id, title, video_url, status, is_seed, category)
       values($1,$2,$3,$4,'live',false,$5)`,
      [roomId, ENGINE_USER.id, engineRoomTitle(cand), cand.watchUrl || null, sanitizeText(category) || 'gaming'],
    );
    await db.query(
      `insert into markets(
         id, room_id, creator_id, source, question, resolution_rule, sources_of_truth,
         category, image_url, start_time, end_time, resolution_time,
         yes_price, no_price, volume, status, is_seed,
         engine_live_item_id, engine_video_id, engine_channel_slug, engine_watch_url)
       values($1,$2,$3,'sim-engine',$4,$5,$6,$7,$8,$9,$10,$11,0.5,0.5,0,'open',false,$12,$13,$14,$15)`,
      [
        id,
        roomId,
        ENGINE_USER.id,
        question,
        resolutionRule,
        sourcesOfTruth,
        category,
        cand.thumbnailUrl || null, // real stream thumbnail (or honestly null)
        start,
        end,
        resolution,
        cand.liveItemId,
        cand.videoId,
        cand.channelSlug,
        cand.watchUrl,
      ],
    );
    return { created: id };
  }

  // One rotation. `force` bypasses ONLY the ≥3-open rotation gate (for dev/proof); it
  // never bypasses the disabled guard, the daily budget, or question dedup.
  async function tick({ force = false } = {}) {
    if (state.ticking) return { skipped: 'in-flight' };
    if (!gemini || typeof gemini.generateJson !== 'function' || gemini.isEnabled?.() === false) {
      // DISABLE-SAFE: keep whatever is already stored; no call, no crash, no wipe.
      return { skipped: 'disabled', keptBatch: state.lastBatch || null };
    }

    state.ticking = true;
    try {
      const day = utcDay(now());
      const used = await readBudget(day);
      if (used >= budgetPerDay) {
        warn(`marketEngine: gemini budget exhausted (${used}/${budgetPerDay} for ${day}) → skipping tick`);
        return { skipped: 'budget', day, used };
      }

      const openCount = await openEngineCount();
      if (!force && openCount >= cfg.maxOpenEngineMarkets) {
        return { skipped: 'rotation-full', openCount };
      }

      await ensureEngineUser();
      const candidates = await snapshotCandidates();
      if (candidates.length === 0) {
        // Nothing live to bind to — do NOT fabricate; keep last batch (never wipe).
        warn('marketEngine: no live items in snapshot → keeping last batch');
        return { skipped: 'no-live', keptBatch: state.lastBatch || null };
      }

      // Spend a call for THIS attempt (bounded cap must hold even on a thrown error).
      const callsAfter = await spendBudget(day);

      let batch;
      try {
        batch = await generateBatch(candidates);
      } catch (e) {
        state.lastError = { at: now(), code: e.code || e.name, message: e.message };
        warn(`marketEngine: gemini generation failed (${e.code || e.name}) → keeping last batch`);
        return { skipped: 'gemini-error', error: e.code || e.name, keptBatch: state.lastBatch || null };
      }

      let created = 0;
      let dupes = 0;
      for (const market of batch) {
        const res = await insertEngineMarket(market);
        if (res.created) created += 1;
        else dupes += 1;
      }
      const summary = {
        at: now(),
        day,
        calls: callsAfter,
        offered: candidates.length,
        generated: batch.length,
        created,
        deduped: dupes,
      };
      state.lastBatch = summary;
      state.totalCalls += 1;
      state.totalCreated += created;
      return summary;
    } finally {
      state.ticking = false;
    }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    // Immediate kick so a fresh boot already has markets; then every rotationMs.
    void tick().catch((e) => warn(`marketEngine: initial tick threw (${e.message})`));
    interval = setIntervalImpl(() => {
      void tick().catch((e) => warn(`marketEngine: tick threw (${e.message})`));
    }, cfg.rotationMs);
    if (interval && interval.unref) interval.unref();
  }

  function stop() {
    state.running = false;
    if (interval) {
      clearIntervalImpl(interval);
      interval = null;
    }
  }

  function status() {
    return {
      running: state.running,
      lastBatch: state.lastBatch,
      lastError: state.lastError,
      budgetDay: state.budgetDay,
      budgetCalls: state.budgetCalls,
      budgetPerDay,
      totalCalls: state.totalCalls,
      totalCreated: state.totalCreated,
    };
  }

  return { tick, start, stop, status, _state: state };
}
