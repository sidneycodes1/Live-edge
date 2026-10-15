import { randomUUID } from 'node:crypto';
import { sanitizeText } from './sanitize.js';

// ---------------------------------------------------------------------------
// Broadcast-aligned market engine (Phase 2, server/src/services/marketEngine.js).
//
// THE USER'S CORE DEMAND: prediction markets must be BORN FROM WHAT IS LIVE RIGHT
// NOW — never an empty grid, and rotated ~every 30 minutes so tomorrow's app is not
// today's. Every rotation:
//   1. snapshot the CURRENT live grid (aggregator cache),
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
  // CONTINUITY (owner fix, Oct 2026): rotate FASTER than a bet's lifetime so a fresh
  // batch is ALWAYS created while the previous one is still open — the rails never sit
  // empty between rotations. Previously rotationMs == marketTtlMs (both 30m) and the
  // interval was anchored to boot, so the tick at boot+30m saw the old batch STILL
  // open (by seconds) → skipped 'rotation-full' → they closed moments later → the next
  // tick was another 30m away → a recurring empty window. Now: a new batch every 15m,
  // each lives 45m → ~3 staggered batches overlap → openCount never collapses to 0.
  rotationMs: 15 * 60 * 1000, // ~every 15 minutes (a new batch)
  retryMs: 3 * 60 * 1000, // fast-retry base after a transient failure
  marketTtlMs: 45 * 60 * 1000, // end_time = now + 45 min (outlives 3 rotation slots)
  budgetPerDay: 200, // aggregate attempts/day ceiling across ALL LLM providers
  maxOpenEngineMarkets: 9, // allow the ~3 overlapping batches; cap runaway stacking
  marketsMin: 3, // per batch (from the LLM)
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

// Map a snapshot item (LiveChannel | curated item) to the small "candidate" the
// prompt + insert need. Never fabricates: fields we don't have stay null.
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
    kind, // 'live'
    videoId,
    channelSlug: item.channelSlug || item.owner || null,
    title: sanitizeText(item.title),
    channelName: sanitizeText(item.channelName || item.owner),
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
          // The model's honest opening line: P(YES) right now. Optional — a missing
          // value degrades to a flat 0.5 (the historical open), never a crash.
          openingProbability: { type: 'NUMBER' },
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
    'Below are streams that are LIVE RIGHT NOW. Produce between 3 and 5 questions.',
    'DIVERSITY IS MANDATORY - the feed looks broken if two cards ask the same thing:',
    '  - Put each question on a DIFFERENT stream: use a UNIQUE liveItemId per market and',
    '    NEVER write two markets about the same stream.',
    '  - Every question must be a DIFFERENT, non-overlapping event. Do NOT rephrase one',
    '    idea into two, and do NOT ask twice about the same action/subject/metric (e.g.',
    '    never two "will X clip / how many clips" questions, even on different streams).',
    '  - Spread across the streams/categories shown below rather than clustering on one.',
    'Content rules:',
    '  - Each item MUST set liveItemId to EXACTLY one id from the list (copy it verbatim).',
    '  - question: a single yes/no question, 8-140 chars, ending in "?", about something',
    '    genuinely resolvable on THAT broadcast in the next ~30 minutes.',
    '  - resolutionRule: one plain sentence stating how YES is decided.',
    '  - category: the stream category shown.',
    '  - openingProbability: your honest estimate, between 0.05 and 0.95, that the',
    '    answer is YES right now. This becomes the market OPENING line, so vary it with',
    '    your read of the stream — do NOT default everything to 0.5.',
    '  - Do not repeat a question. Do not reference streams not in the list.',
    'Return JSON only: { "markets": [ { "liveItemId", "question", "resolutionRule", "category", "openingProbability" } ] }',
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

// Clamp the model's opening line into the markets.prior_yes CHECK (open interval) and
// keep the LMSR log-odds finite. A missing / non-numeric value degrades to 0.5 — the
// exact historical flat open — so an uncooperative model can never break a market.
function clampPrior(raw) {
  const p = Number(raw);
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.95, Math.max(0.05, p));
}

// Round a displayed price to 6 decimals so 1-prior never stores float noise
// (e.g. 1-0.95 -> 0.05000000000000004). Matches the LMSR helper's precision.
const roundPrice = (n) => Math.round(n * 1e6) / 1e6;

export function createMarketEngine(options = {}) {
  const {
    db,
    gemini,
    aggregator,
    kick,
    youtube,
    env = {},
    defaults = {},
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    warn = (msg) => console.warn(msg),
  } = options;

  const cfg = { ...ENGINE_DEFAULTS, ...defaults };
  // Aggregate attempts/day ceiling across the whole LLM chain (a runaway guard,
  // distinct from each provider's own per-day cap enforced in services/llm/chain.js).
  const budgetPerDay = Number(env.LLM_BUDGET_PER_DAY) || cfg.budgetPerDay;

  const state = {
    running: false,
    ticking: false,
    lastBatch: null, // last successful generation summary (kept for status/disabled path)
    lastError: null,
    budgetDay: null, // UTC day the in-memory counter applies to
    budgetCalls: 0, // in-memory mirror of engine_budget.calls for budgetDay
    totalCalls: 0, // lifetime successful generations (health/proof)
    totalCreated: 0,
    retryTimer: null, // pending fast-retry (setTimeout handle)
    retryAttempt: 0, // depth of the backoff ladder
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

  // P1 (owner fix, Oct 2026): a bet must be about a broadcast that is LIVE RIGHT NOW,
  // not one that already ended. The live GRID already prunes ended streams, but a
  // market born 20 minutes ago keeps its 45-minute timer even after its source stream
  // goes dark — so the landing showed bets on finished broadcasts. Every rotation we
  // re-prove each OPEN sim-engine market's OWN source and close the ones PROVABLY over
  // (YouTube actualEndTime / Kick is_live=false). Conservative: an unknown (no creds,
  // video not found, request failed) KEEPS the bet — we never remove what we cannot
  // prove is gone. Closing only flips status; the rooms-list open-market filter then
  // hides the room, and no trade/ledger row is ever deleted. Simulated money; this is a
  // liveness truth, not a settlement.
  async function pruneEndedMarkets() {
    const { rows } = await db.query(
      `select id, engine_video_id, engine_channel_slug from markets
        where source='sim-engine' and status='open'
          and (engine_video_id is not null or engine_channel_slug is not null)`,
    );
    let closed = 0;
    for (const m of rows) {
      let live = null; // null = unknown → keep
      if (m.engine_video_id && typeof youtube?.isVideoLive === 'function') {
        live = await youtube.isVideoLive(m.engine_video_id);
      } else if (m.engine_channel_slug && typeof kick?.getChannelBySlug === 'function') {
        const ch = await kick.getChannelBySlug(m.engine_channel_slug);
        live = ch ? Boolean(ch.isLive) : null;
      }
      if (live === false) {
        await db.query(`update markets set status='closed' where id=$1 and status='open'`, [m.id]);
        closed += 1;
      }
    }
    return closed;
  }

  // Live grid (via aggregator's cache/ladder), deduped by id.
  // BROADCAST RULE (user): a bet is born from a live BROADCAST — a candidate must
  // carry a real WATCHABLE stream. The watchability guarantee is `watchUrl` (a live
  // kick.com/<slug> or a YouTube watch page). A thumbnail is NOT required: the public
  // Kick API exposes no thumbnail and §4 forbids fabricating one, so gating on
  // thumbnailUrl silently disqualified the ENTIRE primary source (Kick always fills the
  // grid past the curated-fill threshold, so the thumbnail-bearing curated rows never
  // reached the engine either) → zero candidates → no AI markets, ever. Requiring
  // watchUrl still rejects data-only feed items (no stream), which is the rule's intent.
  function isBroadcastCandidate(c) {
    return Boolean(c && c.watchUrl);
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
    const usedStreams = new Set(); // DIVERSITY: at most ONE market per live stream per batch
    for (const m of list) {
      const cand = byId.get(String(m?.liveItemId));
      if (!cand) continue; // ties to a stream NOT in the snapshot → drop (§4 honesty)
      if (usedStreams.has(cand.liveItemId)) continue; // already have a market on this stream -> drop the clone
      const question = normalizeQuestion(m?.question);
      if (!question) continue;
      usedStreams.add(cand.liveItemId);
      out.push({
        cand,
        question,
        resolutionRule: sanitizeText(m?.resolutionRule) || 'Resolved from the live broadcast named in the question.',
        category: sanitizeText(m?.category) || cand.category || cand.kind || 'gaming',
        prior: clampPrior(m?.openingProbability),
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

  async function insertEngineMarket({ cand, question, resolutionRule, category, prior }) {
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
    // Opening line: the model's honest prior (already clamped). Shown price == the
    // price the first bettor executes against, and the LMSR-with-prior curve opens at
    // exactly this value at q=0. A missing prior degrades to the historical 0.5.
    const p = clampPrior(prior);
    await db.query(
      `insert into rooms(id, owner_id, title, video_url, status, is_seed, category)
       values($1,$2,$3,$4,'live',false,$5)`,
      [roomId, ENGINE_USER.id, engineRoomTitle(cand), cand.watchUrl || null, sanitizeText(category) || 'gaming'],
    );
    await db.query(
      `insert into markets(
         id, room_id, creator_id, source, question, resolution_rule, sources_of_truth,
         category, image_url, start_time, end_time, resolution_time,
         prior_yes, yes_price, no_price, volume, status, is_seed,
         engine_live_item_id, engine_video_id, engine_channel_slug, engine_watch_url)
       values($1,$2,$3,'sim-engine',$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,0,'open',false,$14,$15,$16,$17)`,
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
        p,
        roundPrice(1 - p),
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
    state.ticking = true;
    try {
      // P1 (owner fix, Oct 2026): LIVENESS PRUNE runs on EVERY rotation, AHEAD of the
      // generation gates, so a bet whose broadcast has PROVABLY ended is retired even
      // when the LLM is disabled / over budget / rotation-full. Best-effort: a probe
      // failure never over-closes (pruneEndedMarkets only flips streams proven dead).
      try {
        state.lastPruned = await pruneEndedMarkets();
      } catch (e) {
        warn(`marketEngine: liveness prune failed (${e.code || e.name || e.message})`);
      }

      if (!gemini || typeof gemini.generateJson !== 'function' || gemini.isEnabled?.() === false) {
        // DISABLE-SAFE: keep whatever is already stored; no call, no crash, no wipe.
        return { skipped: 'disabled', keptBatch: state.lastBatch || null };
      }

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
    void run().catch((e) => warn(`marketEngine: initial tick threw (${e.message})`));
    interval = setIntervalImpl(() => {
      void run().catch((e) => warn(`marketEngine: tick threw (${e.message})`));
    }, cfg.rotationMs);
    if (interval && interval.unref) interval.unref();
  }

  function stop() {
    state.running = false;
    if (interval) {
      clearIntervalImpl(interval);
      interval = null;
    }
    clearRetry();
  }

  // Fast-retry ladder after a TRANSIENT failure (Gemini 429/503, or a cold boot
  // whose snapshot had no live items yet). Without this a failed boot tick waits
  // the full 30-minute rotation and the landing rails sit on seed-only data.
  // Backoff: retryMs, 3×retryMs, 9×… capped at rotationMs; ANY non-failure
  // outcome resets the ladder. Budget still guards every attempt (40/day).
  function clearRetry() {
    if (state.retryTimer) {
      clearTimeoutImpl(state.retryTimer);
      state.retryTimer = null;
    }
  }

  function scheduleRetry() {
    if (!state.running || state.retryTimer) return;
    const delay = Math.min(cfg.rotationMs, cfg.retryMs * 3 ** state.retryAttempt);
    state.retryAttempt += 1;
    state.retryTimer = setTimeoutImpl(() => {
      state.retryTimer = null;
      void run().catch((e) => warn(`marketEngine: retry tick threw (${e.message})`));
    }, delay);
    if (state.retryTimer && state.retryTimer.unref) state.retryTimer.unref();
  }

  async function run() {
    const res = await tick();
    if (res && (res.skipped === 'gemini-error' || res.skipped === 'no-live')) scheduleRetry();
    else state.retryAttempt = 0;
    return res;
  }

  function status() {
    return {
      running: state.running,
      lastBatch: state.lastBatch,
      lastError: state.lastError,
      retryAttempt: state.retryAttempt,
      budgetDay: state.budgetDay,
      budgetCalls: state.budgetCalls,
      budgetPerDay,
      totalCalls: state.totalCalls,
      totalCreated: state.totalCreated,
    };
  }

  return { tick, start, stop, status, _state: state };
}
