import {
  createProviderRunner,
  createCircuitBreaker,
  createBulkhead,
  TIMEOUT_MS,
  RETRIES,
  BREAKER_THRESHOLD,
  BREAKER_COOLDOWN_MS,
  BULKHEAD_LIMIT,
} from './resilience.js';
import { LIVE_SOURCES } from './schema.js';

// Landing-grid fill goal (Phase 2): curated 24/7 channels top the merged result up
// to at least this many real cards when live providers come up short (e.g. the
// YouTube SEARCH quota is exhausted). Bounded by the caller's `limit`.
const CURATED_FILL_MIN = 12;

// ---------------------------------------------------------------------------
// The multi-source live aggregator. Owns two guarantees:
//
//  1) MERGE: call every ENABLED provider concurrently — each wrapped in
//     bulkhead(≤3) → circuit-breaker(3→30s) → retry(1) → timeout(2.5s) — and
//     merge the results into one LiveChannel[] in priority order
//     (Kick→YouTube→Floor), deduped by namespaced id, sorted by viewers.
//     A single provider failing never affects the others (runSafe → []).
//
//  2) NEVER-EMPTY LADDER (only when the merge is empty — every live source came
//     back empty/failed): Kick→YouTube were both tried above; then serve the
//     last-good STALE cache; then the config-driven Floor fallback (no network).
//     If even the floor is unconfigured we return an honest [] (and the route
//     reports degraded) rather than fabricate a stream — real-vs-simulated honesty.
//
// Twitch was retired as a provider Oct 2026 (Kick is the primary real-stream
// source); each remaining client already returns normalized LiveChannel[]s, so
// the contract is assembled here with no per-source mapping left.
// ---------------------------------------------------------------------------

function dedupeSorted(items, limit) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  // Highest-viewership first for the landing grid; ties keep priority order.
  out.sort((a, b) => b.viewerCount - a.viewerCount);
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

// Extract the bare YouTube video id from a namespaced item id so the SAME real
// stream surfaced by two shapes is deduped regardless of namespace: provider
// LiveChannels are `youtube:<vid>` (schema.channelId) and curated items are
// `yt-<vid>` (../curated/client.js). Anything without a video id → null.
function videoIdOf(item) {
  const id = item && item.id;
  if (typeof id !== 'string') return null;
  if (id.startsWith('yt-')) return id.slice(3);
  if (id.startsWith('youtube:')) return id.slice(8);
  return null;
}

export function createLiveAggregator({
  kick,
  youtube,
  floor,
  curated,
  enabled = {},
  limits = {},
  resilience = {},
  now = () => Date.now(),
  warn = (msg) => console.warn(msg),
} = {}) {
  const timeoutMs = resilience.timeoutMs ?? TIMEOUT_MS;
  const retries = resilience.retries ?? RETRIES;
  const threshold = resilience.breakerThreshold ?? BREAKER_THRESHOLD;
  const cooldownMs = resilience.breakerCooldownMs ?? BREAKER_COOLDOWN_MS;
  const bulkheadLimit = resilience.bulkheadLimit ?? BULKHEAD_LIMIT;

  // Per-provider thunks returning LiveChannel[]. Each is guarded so it can't throw
  // out of the merge. Providers are enabled independently (flag && client present).
  const defs = [
    {
      name: 'kick',
      isOn: enabled.kick && typeof kick?.getTopLiveChannels === 'function',
      fetch: (limit) => kick.getTopLiveChannels(limit),
    },
    {
      name: 'youtube',
      isOn: enabled.youtube && typeof youtube?.getTopLiveChannels === 'function',
      fetch: (limit) => youtube.getTopLiveChannels(limit),
      // Tier-B multi-query: one logical fetch = several search round-trips
      // (concurrent, but still slower than a single call). The shared 2.5s
      // single-call budget tripped TIMEOUT in the live proof — dedicated runner.
      timeoutMs: resilience.youtubeTimeoutMs ?? 8000,
    },
    {
      name: 'floor',
      isOn: enabled.floor && typeof floor?.getTopLiveChannels === 'function',
      fetch: (limit) => floor.getTopLiveChannels(limit),
    },
  ].filter((d) => d.isOn);

  const runners = {};
  for (const d of defs) {
    runners[d.name] = createProviderRunner({
      name: d.name,
      timeoutMs: d.timeoutMs ?? timeoutMs,
      retries,
      breaker: createCircuitBreaker({ threshold, cooldownMs, now }),
      bulkhead: createBulkhead({ limit: bulkheadLimit }),
      warn,
    });
  }

  // Curated always-live source (Phase 2). NOT a credentialed provider and NOT part
  // of LIVE_SOURCES (§3 wire keys stay exactly 4): it is a quota-free POST-MERGE FILL
  // so the grid still serves ≥12 real live cards when the YouTube SEARCH budget is
  // exhausted (429). It gets its OWN runner with a larger timeout because a single
  // getChannels() call fans out 10 parallel keyless RSS fetches (each internally
  // bounded at 8s) — far beyond the 2.5s provider budget on a cold fetch. Only used
  // when a curated client is actually wired in.
  const curatedRunner = createProviderRunner({
    name: 'curated',
    timeoutMs: resilience.curatedTimeoutMs ?? 10000,
    retries,
    breaker: createCircuitBreaker({ threshold, cooldownMs, now }),
    bulkhead: createBulkhead({ limit: bulkheadLimit }),
    warn,
  });

  // Last-good non-empty merged result, used only by the ladder's "stale" rung.
  let staleCache = [];

  async function getChannels(limit = 24) {
    const results = await Promise.all(
      defs.map(async (d) => {
        const reqLimit = limits[d.name] ?? limit;
        const r = await runners[d.name].runSafe(() => d.fetch(reqLimit), []);
        return { name: d.name, ...r };
      }),
    );

    // Preserve priority order when merging (dedupe/sort runs after).
    const ordered = LIVE_SOURCES.map((src) => results.find((r) => r.name === src)).filter(Boolean);
    const mergedRaw = ordered.flatMap((r) => r.value || []);
    const items = dedupeSorted(mergedRaw, limit);

    const sources = {};
    const degraded = [];
    for (const r of ordered) {
      sources[r.name] = (r.value || []).length;
      if (r.degraded) degraded.push({ source: r.name, reason: r.reason || 'ERROR' });
    }

    // Curated post-merge FILL (Phase 2). Real provider results always come FIRST;
    // curated only APPENDS quota-free 24/7 channels to reach the ≥12 goal (never
    // exceeding `limit`). Its failure can NEVER break the grid: runSafe falls back to
    // [] and we merely record the source degraded internally. It runs even when the
    // merge was empty (search quota dead + no creds) so the fast path below can still
    // return real cards instead of dropping to the stale/floor ladder.
    const fillTarget = Math.min(CURATED_FILL_MIN, limit);
    if (items.length < limit && items.length < fillTarget && typeof curated?.getChannels === 'function') {
      const cr = await curatedRunner.runSafe(() => curated.getChannels(), []);
      const curatedItems = cr.value || [];
      sources.curated = curatedItems.length; // introspection; NOT a LIVE_SOURCES key
      if (cr.degraded) degraded.push({ source: 'curated', reason: cr.reason || 'ERROR' });
      const seenIds = new Set(items.map((it) => it.id));
      const seenVids = new Set(items.map(videoIdOf).filter(Boolean));
      for (const c of curatedItems) {
        if (items.length >= fillTarget || items.length >= limit) break;
        if (!c || seenIds.has(c.id)) continue;
        const vid = videoIdOf(c);
        if (vid && seenVids.has(vid)) continue;
        items.push(c);
        seenIds.add(c.id);
        if (vid) seenVids.add(vid);
      }
    }

    // Fast path: real merged data → remember it as stale fuel and return.
    if (items.length > 0) {
      staleCache = items;
      return { items, sources, degraded, usedStale: false, usedFloor: false, generatedAt: now() };
    }

    // Never-empty ladder (merge was empty).
    if (staleCache.length > 0) {
      warn('live aggregator: all sources empty → serving last-good stale cache');
      return { items: staleCache.slice(0, limit), sources, degraded, usedStale: true, usedFloor: false, generatedAt: now() };
    }
    if (typeof floor?.getGuaranteedChannel === 'function') {
      const fb = floor.getGuaranteedChannel();
      if (fb.length > 0) {
        warn('live aggregator: all sources empty & no stale → serving config floor fallback');
        return { items: fb, sources, degraded, usedStale: false, usedFloor: true, generatedAt: now() };
      }
    }

    // Truly nothing (no live data, no cache, floor unconfigured): honest empty.
    warn('live aggregator: no live data available and no floor fallback configured');
    return { items: [], sources, degraded, usedStale: false, usedFloor: false, generatedAt: now() };
  }

  return {
    getChannels,
    providers: defs.map((d) => d.name),
    // introspection for tests / health
    _runners: runners,
    _curatedRunner: curatedRunner,
    _stale: () => staleCache,
  };
}
