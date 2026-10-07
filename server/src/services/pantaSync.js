import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Panta real-time SYNC poller (Door 1: real data, simulated money).
//   server/src/services/pantaSync.js
//
// ONE process-wide poller (NEVER per-user) that reads Panta's real LIST endpoint
// (prices are batched into every row, so a single read refreshes many markets),
// imports/updates those markets into our `markets` table tagged `source='panta'`
// with `price_source='panta_live'`, and fans the new price out over the SSE hub.
// Users then bet them with LiveEdge's SIMULATED $100 ledger — nothing here ever
// touches the chain or spends real money.
//
// HONESTY LAWS this code must never break (ToU §5/§7 + the project data-honesty
// law):
//   * DISABLE-SAFE  — realtime off / no client ⇒ tick returns {skipped:'disabled'}
//                     and existing markets keep their last-known price. NEVER wipe.
//   * READ BUDGET   — Panta allows ~120 reads / 60s. We count reads per window and
//                     skip (with a single warning) rather than hammer past the cap.
//   * DEGRADE       — 429 / timeout / 5xx ⇒ keep the last-known price, log once, and
//                     flip any price older than `priceStaleAfterMs` to 'stale_panta'
//                     so the UI can honestly say "Stale", never "Live". NEVER fabricate
//                     a price, a volume, or a market that Panta did not return.
//   * NO CASH       — imported prices are DISPLAY only; our local LMSR + ledger still
//                     govern every bet, so money conservation is untouched.
//
// Runner style matches ../services/marketEngine.js and ../aggregator: a pure
// factory with injectable `now` / timer impls / `hub`, returning
// { tick, start, stop, status }. Tests drive tick() directly with a fake client.
// ---------------------------------------------------------------------------

export const PANTA_SYNC_DEFAULTS = {
  pollIntervalMs: 15000, // coarse: one list read refreshes many markets
  priceStaleAfterMs: 60000, // a mirrored price older than this is honestly 'stale'
  listLimit: 100, // rows per list read (Panta caps the page size)
  readBudgetPerWindow: 100, // stay under Panta's ~120/60s, leave headroom for detail reads
  windowMs: 60000, // the read-budget window
  importLimit: 20, // max Panta markets surfaced per tick (primary phase first)
};

// Deterministic system creator for imported Panta markets (markets.creator_id is
// NOT NULL). Fixed id + wallet, never secret; inserted ON CONFLICT DO NOTHING.
export const PANTA_SYNC_USER = {
  id: 'dddddddd-0000-4000-8000-000000000002',
  wallet: 'PantaLiveSystem000000000000000000000000000002',
  displayName: 'Panta Live Markets',
};

// Clamp a string to [min,max] length for a DB CHECK, or null. Never pads/fakes.
function clampText(v, min, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s.length) return null;
  if (s.length < min) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// Panta prices arrive as decimal strings/numbers in the list rows. Coerce to a
// 0..1 number, or null when absent/garbage (so we never invent a price).
function price(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

// Map one Panta list/detail row to our display + mirror fields. Tolerant of both
// the human decimal form (yesPrice) and the base-unit integer form (primaryYesPrice
// is a 9-dec integer string). Anything we can't read stays null (never fabricated).
export function mapPantaRow(row) {
  const id = row?.marketId ?? row?.id ?? null;
  // Panta's list uses several price spellings; primary/last are the live primary ones.
  // A 9-dec integer (e.g. "500000000") is a fraction of 1 → divide by 1e9.
  const rawYes = row?.yesPrice ?? row?.primaryYesPrice ?? row?.lastYesPrice ?? row?.primary?.yesPrice ?? null;
  const yes = rawYes != null && Number(rawYes) > 1 ? Number(rawYes) / 1e9 : price(rawYes);
  const rawNo = row?.noPrice ?? row?.primaryNoPrice ?? null;
  const no = rawNo != null && Number(rawNo) > 1 ? Number(rawNo) / 1e9 : price(rawNo);
  const resolvedYes = yes != null ? yes : null;
  return {
    pantaMarketId: id != null ? String(id) : null,
    question: clampText(row?.question, 8, 140) || clampText(row?.title, 8, 140),
    title: clampText(row?.title, 3, 80),
    category: clampText(row?.category, 1, 40) || 'general',
    imageUrl: clampText(Array.isArray(row?.images) ? row.images[0] : row?.imageUrl, 1, 400),
    yesPrice: resolvedYes,
    noPrice: no != null ? no : (resolvedYes != null ? Math.round((1 - resolvedYes) * 1e6) / 1e6 : null),
    phase: clampText(row?.phase, 1, 20),
    status: clampText(row?.status, 1, 20),
    resolved: row?.resolved ?? row?.isResolved ?? null,
    yesWins: row?.yesWins ?? row?.oracleProposedYesWins ?? null,
    oracle: clampText(row?.oracle, 1, 40),
    graduated: row?.isGraduated ?? row?.graduated ?? null,
    totalVolumeUsdc:
      row?.volumeUsdcBase != null ? Number(row.volumeUsdcBase) / 1e6
        : row?.totalVolumeUsdc != null ? Number(row.totalVolumeUsdc)
        : row?.volumeUsdc != null ? Number(row.volumeUsdc) : null,
    creatorAddress: clampText(row?.creatorAddress, 1, 64),
    isWhitelistedCreator: row?.isWhitelistedCreator ?? null,
  };
}

// Our `status` for an imported market: Panta's resolution is the source of truth;
// otherwise these are open until Panta says otherwise (no fabricated countdown —
// the UI renders `panta_phase`/`panta_status`, not our end_time sentinel).
function deriveStatus(m) {
  if (m.resolved === true) return 'resolved';
  const st = (m.status || '').toLowerCase();
  if (st === 'resolved') return 'resolved';
  if (st === 'closed') return 'closed';
  return 'open';
}
function deriveOutcome(m) {
  if (m.resolved !== true && (m.status || '').toLowerCase() !== 'resolved') return null;
  if (m.yesWins === true) return 'yes';
  if (m.yesWins === false) return 'no';
  return null;
}

export function createPantaSync(options = {}) {
  const {
    db,
    liveClient,
    hub = null,
    env = {},
    defaults = {},
    enabled = true,
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    warn = (msg) => console.warn(msg),
  } = options;

  const cfg = {
    ...PANTA_SYNC_DEFAULTS,
    pollIntervalMs: Number(env.PANTA_POLL_INTERVAL_MS) || PANTA_SYNC_DEFAULTS.pollIntervalMs,
    priceStaleAfterMs: Number(env.PANTA_PRICE_STALE_AFTER_MS) || PANTA_SYNC_DEFAULTS.priceStaleAfterMs,
    ...defaults,
  };

  const state = {
    running: false,
    ticking: false,
    lastSuccessAt: null,
    lastError: null,
    lastImported: 0,
    lastUpdated: 0,
    cursor: null, // Panta's nextCursor for the NEXT page; null = start fresh
    windowStart: 0,
    readsInWindow: 0,
  };
  let interval = null;

  async function ensureSystemUser() {
    await db.query(
      `insert into users(id, wallet, display_name) values($1,$2,$3) on conflict (id) do nothing`,
      [PANTA_SYNC_USER.id, PANTA_SYNC_USER.wallet, PANTA_SYNC_USER.displayName],
    );
  }

  // Read budget: count reads per fixed window so we never cross Panta's ~120/60s.
  function budget() {
    const wStart = Math.floor(now() / cfg.windowMs) * cfg.windowMs;
    if (wStart !== state.windowStart) {
      state.windowStart = wStart;
      state.readsInWindow = 0;
    }
    return { used: state.readsInWindow, cap: cfg.readBudgetPerWindow };
  }

  // Honest degrade: flip every panta_live price older than the TTL to 'stale_panta'.
  // Runs on an upstream failure and on start so a cold/reconnected poller never shows
  // a stale number as if it were live.
  async function markStale() {
    const cutoff = new Date(now() - cfg.priceStaleAfterMs).toISOString();
    const { rows } = await db.query(
      `update markets set price_source='stale_panta'
        where price_source='panta_live' and (price_observed_at is null or price_observed_at < $1)
        returning id`,
      [cutoff],
    );
    return rows.length;
  }

  // Persist the last-known Panta snapshot (raw row + projections) for honest degrade.
  async function upsertCache(m, rawRow, observedAt) {
    await db.query(
      `insert into panta_markets(
         panta_market_id, row, question, title, category, image_url, phase, status,
         yes_price, no_price, price_source, resolved, yes_wins, total_volume_usdc, observed_at, updated_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'panta_live',$11,$12,$13,$14,$14)
       on conflict (panta_market_id) do update set
         row=excluded.row, question=excluded.question, title=excluded.title, category=excluded.category,
         image_url=excluded.image_url, phase=excluded.phase, status=excluded.status,
         yes_price=excluded.yes_price, no_price=excluded.no_price, price_source='panta_live',
         resolved=excluded.resolved, yes_wins=excluded.yes_wins,
         total_volume_usdc=excluded.total_volume_usdc, observed_at=excluded.observed_at, updated_at=excluded.updated_at`,
      [
        m.pantaMarketId,
        JSON.stringify(rawRow),
        m.question, m.title, m.category, m.imageUrl, m.phase, m.status,
        m.yesPrice, m.noPrice, m.resolved, m.yesWins, m.totalVolumeUsdc, observedAt,
      ],
    );
  }

  // Import/update one Panta market into `markets` (source='panta'). Creates a room on
  // first sight so it is a first-class bettable surface with an SSE channel. Returns
  // { roomId, yesPrice, noPrice, created } for the fan-out, or null if unusable.
  async function upsertMarket(m, observedAt) {
    if (!m.pantaMarketId || !m.question) return null; // no id or no readable question → skip (never untethered/blank)

    const { rows: existing } = await db.query(
      `select id, room_id, status, outcome from markets where panta_market_id=$1`,
      [m.pantaMarketId],
    );

    const status = deriveStatus(m);
    const outcome = deriveOutcome(m);
    // Display price comes straight from Panta when we have it; a market with no
    // readable price keeps whatever we last showed (never a fabricated 0.5 flip).
    const yesPrice = m.yesPrice;
    const noPrice = m.noPrice;

    if (existing.length > 0) {
      const row = existing[0];
      await db.query(
        `update markets set
           question=$2, category=$3, image_url=coalesce($4, image_url),
           panta_phase=$5, panta_status=$6, panta_resolved=$7, panta_yes_wins=$8, panta_oracle=$9,
           panta_graduated=$10, panta_total_volume_usdc=$11, panta_creator_address=$12, panta_is_whitelisted_creator=$13,
           yes_price=coalesce($14, yes_price), no_price=coalesce($15, no_price),
           price_source='panta_live', price_observed_at=$16, status=$17, outcome=$18
         where id=$1`,
        [
          row.id, m.question, m.category, m.imageUrl, m.phase, m.status, m.resolved, m.yesWins, m.oracle,
          m.graduated, m.totalVolumeUsdc, m.creatorAddress, m.isWhitelistedCreator,
          yesPrice, noPrice, observedAt, status, outcome,
        ],
      );
      return { roomId: row.room_id, yesPrice, noPrice, created: false, statusChanged: row.status !== status, status, outcome, prevStatus: row.status };
    }

    // First sight → make a room (title = the real Panta question, clamped) + market.
    const id = randomUUID();
    const roomId = randomUUID();
    const roomTitle = clampText(m.title || m.question, 3, 80) || 'Panta market';
    await db.query(
      `insert into rooms(id, owner_id, title, status, is_seed) values($1,$2,$3,'live',false)`,
      [roomId, PANTA_SYNC_USER.id, roomTitle],
    );
    // start/end/resolution are NOT NULL in our schema but Panta governs these markets'
    // real life-cycle; the UI shows panta_phase, so we store a far-future sentinel that
    // keeps the market bettable-until-Panta-resolves rather than a fabricated countdown.
    const start = new Date(now()).toISOString();
    const end = new Date(Date.UTC(2999, 11, 31)).toISOString();
    const sourcesOfTruth = [`panta:${m.pantaMarketId}`];
    await db.query(
      `insert into markets(
         id, room_id, creator_id, source, panta_market_id, question, resolution_rule, sources_of_truth,
         category, image_url, start_time, end_time, resolution_time,
         yes_price, no_price, volume, status, outcome, is_seed,
         panta_phase, panta_status, panta_resolved, panta_yes_wins, panta_oracle,
         panta_graduated, panta_total_volume_usdc, panta_creator_address, panta_is_whitelisted_creator,
         price_source, price_observed_at)
       values($1,$2,$3,'panta',$4,$5,$6,$7,$8,$9,$10,$11,$12,
              coalesce($13,0.5),coalesce($14,0.5),0,$15,$16,false,
              $17,$18,$19,$20,$21,$22,$23,$24,$25,'panta_live',$26)`,
      [
        id, roomId, PANTA_SYNC_USER.id, m.pantaMarketId, m.question,
        'Resolved by the Panta oracle per the market’s own on-chain rules.', sourcesOfTruth,
        m.category, m.imageUrl, start, end, end,
        yesPrice, noPrice, status, outcome,
        m.phase, m.status, m.resolved, m.yesWins, m.oracle,
        m.graduated, m.totalVolumeUsdc, m.creatorAddress, m.isWhitelistedCreator,
        observedAt,
      ],
    );
    return { roomId, yesPrice, noPrice, created: true, statusChanged: false, status, outcome, prevStatus: null };
  }

  // One poll cycle: read the Panta list, upsert each primary-phase market, fan out.
  async function tick() {
    if (!enabled || !liveClient || typeof liveClient.listMarkets !== 'function') {
      // DISABLE-SAFE: keep last-known prices; no call, no crash, never a wipe.
      return { skipped: 'disabled' };
    }
    if (state.ticking) return { skipped: 'in-flight' };

    const b = budget();
    if (b.used >= b.cap) {
      warn(`pantaSync: read budget reached (${b.used}/${b.cap} this window) → skipping tick`);
      return { skipped: 'budget', used: b.used };
    }

    state.ticking = true;
    try {
      await ensureSystemUser();
      // Spend the read BEFORE the call so a thrown error still counts (cap must hold).
      state.readsInWindow += 1;

      let payload;
      try {
        payload = await liveClient.listMarkets({ limit: cfg.listLimit, cursor: state.cursor || undefined });
      } catch (e) {
        // Upstream failure → honest degrade: KEEP last-known, flip stale, no wipe.
        state.lastError = { at: now(), code: e.code || e.name || 'ERROR', message: e.message };
        const stale = await markStale();
        warn(`pantaSync: list read failed (${e.code || e.name}) → keeping last-known, ${stale} marked stale`);
        return { skipped: 'upstream-error', error: e.code || e.name || 'ERROR', markedStale: stale };
      }

      const items = Array.isArray(payload?.items) ? payload.items : [];
      state.cursor = payload?.nextCursor || null; // null/absent → next tick re-reads page 1
      const observedAt = new Date(now()).toISOString();

      // Primary phase first (mirror the plan's "primary-phase markets first" rule),
      // then anything else that carried a readable price. Cap at importLimit/tick.
      const ordered = [
        ...items.filter((r) => (r?.phase || '').toLowerCase() === 'primary'),
        ...items.filter((r) => (r?.phase || '').toLowerCase() !== 'primary'),
      ];

      let imported = 0;
      let updated = 0;
      for (const rawRow of ordered) {
        if (imported + updated >= cfg.importLimit) break;
        const m = mapPantaRow(rawRow);
        if (!m.pantaMarketId || !m.question) continue; // never fabricate/untether
        await upsertCache(m, rawRow, observedAt);
        const res = await upsertMarket(m, observedAt);
        if (!res) continue;
        if (res.created) imported += 1;
        else updated += 1;
        // Fan the fresh price out to everyone already in this market's room.
        if (hub && res.roomId && (res.yesPrice != null || res.noPrice != null)) {
          hub.broadcast(res.roomId, 'odds', {
            pantaMarketId: m.pantaMarketId,
            yesPrice: res.yesPrice,
            noPrice: res.noPrice,
            priceSource: 'panta_live',
            observedAt,
          });
        }
        // Panta's oracle is the source of truth — when a mirrored market flips phase
        // or resolves, tell every open room so the UI stops offering a closed bet.
        if (hub && res.roomId && res.statusChanged) {
          hub.broadcast(res.roomId, 'market_status', {
            pantaMarketId: m.pantaMarketId,
            status: res.status,
            outcome: res.outcome,
            observedAt,
          });
        }
      }

      state.lastSuccessAt = now();
      state.lastError = null;
      state.lastImported = imported;
      state.lastUpdated = updated;
      await db.query(
        `insert into panta_sync_state(id, last_cursor, last_success_at, last_error, remaining_reads, updated_at)
         values(1,$1,$2,null,$3,$2)
         on conflict (id) do update set
           last_cursor=excluded.last_cursor, last_success_at=excluded.last_success_at,
           last_error=null, remaining_reads=excluded.remaining_reads, updated_at=excluded.updated_at`,
        [state.cursor, observedAt, Math.max(0, b.cap - state.readsInWindow)],
      );
      return { imported, updated, offered: items.length, cursor: state.cursor };
    } finally {
      state.ticking = false;
    }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    void run().catch((e) => warn(`pantaSync: initial tick threw (${e.message})`));
    interval = setIntervalImpl(() => {
      void run().catch((e) => warn(`pantaSync: tick threw (${e.message})`));
    }, cfg.pollIntervalMs);
    if (interval && interval.unref) interval.unref();
  }

  function stop() {
    state.running = false;
    if (interval) {
      clearIntervalImpl(interval);
      interval = null;
    }
  }

  async function run() {
    return tick();
  }

  function status() {
    const b = budget();
    return {
      running: state.running,
      enabled,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      lastImported: state.lastImported,
      lastUpdated: state.lastUpdated,
      cursor: state.cursor,
      readsInWindow: b.used,
      readBudget: b.cap,
    };
  }

  return { tick, start, stop, status, markStale, _state: state };
}
