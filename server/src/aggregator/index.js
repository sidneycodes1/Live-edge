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
import { makeLiveChannel, LIVE_SOURCES } from './schema.js';

// ---------------------------------------------------------------------------
// The multi-source live aggregator. Owns two guarantees:
//
//  1) MERGE: call every ENABLED provider concurrently — each wrapped in
//     bulkhead(≤3) → circuit-breaker(3→30s) → retry(1) → timeout(2.5s) — and
//     merge the results into one LiveChannel[] in priority order
//     (Twitch→Kick→YouTube→Floor), deduped by namespaced id, sorted by viewers.
//     A single provider failing never affects the others (runSafe → []).
//
//  2) NEVER-EMPTY LADDER (only when the merge is empty — every live source came
//     back empty/failed): Twitch→Kick→YouTube were all tried above; then serve the
//     last-good STALE cache; then the config-driven Floor fallback (no network).
//     If even the floor is unconfigured we return an honest [] (and the route
//     reports degraded) rather than fabricate a stream — real-vs-simulated honesty.
//
// Twitch keeps its existing normalized shape (../twitch/client.js) and is mapped
// here, NOT modified — the aggregator is the only place the LiveChannel contract is
// assembled for twitch, so the shipped /api/twitch/live path is untouched.
// ---------------------------------------------------------------------------

// Map a raw twitch stream (from twitch.getTopLiveStreams) → LiveChannel.
export function twitchToLiveChannel(s) {
  const login = s.userLogin || '';
  return makeLiveChannel({
    source: 'twitch',
    nativeId: s.id,
    title: s.title,
    channelName: s.userName || login,
    channelSlug: login,
    category: s.gameName,
    viewerCount: s.viewerCount,
    startedAt: s.startedAt,
    thumbnailUrl: s.thumbnailUrl,
    isLive: true,
    isMature: s.isMature,
    watchUrl: login ? `https://twitch.tv/${encodeURIComponent(login)}` : null,
    language: s.language,
  });
}

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

export function createLiveAggregator({
  twitch,
  kick,
  youtube,
  floor,
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
      name: 'twitch',
      isOn: enabled.twitch && typeof twitch?.getTopLiveStreams === 'function',
      // Map twitch's own shape → LiveChannel here (aggregator-owned, not twitch).
      fetch: (limit) => twitch.getTopLiveStreams(limit).then((list) => (list || []).map(twitchToLiveChannel)),
    },
    {
      name: 'kick',
      isOn: enabled.kick && typeof kick?.getTopLiveChannels === 'function',
      fetch: (limit) => kick.getTopLiveChannels(limit),
    },
    {
      name: 'youtube',
      isOn: enabled.youtube && typeof youtube?.getTopLiveChannels === 'function',
      fetch: (limit) => youtube.getTopLiveChannels(limit),
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
      timeoutMs,
      retries,
      breaker: createCircuitBreaker({ threshold, cooldownMs, now }),
      bulkhead: createBulkhead({ limit: bulkheadLimit }),
      warn,
    });
  }

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
    _stale: () => staleCache,
  };
}
