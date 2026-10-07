// Pure honesty logic behind <MarketSourceChip /> (Door 1 / ToU §5). Extracted so
// the labeling rules are unit-tested independently of rendering (mirrors the
// lib/countdown.js pattern: logic here, the component just draws it).
//
// The three provable states a displayed price can be in:
//   panta_live + observed within TTL  -> "Live · Panta"   (a real Panta quote)
//   panta_live but OLDER than TTL      -> "Stale · Panta" (honest degrade, client-side)
//   stale_panta                        -> "Stale · Panta"
//   anything else (incl. simulated)    -> "Simulated"     (our own play-money number)
// A simulated/stale figure can NEVER read as a live Panta quote.

export const STALE_FALLBACK_MS = 60000;

// Human "Xs/Xm/Xh ago" from an ISO timestamp relative to `nowMs`. Returns null for
// a missing/invalid time (never a fabricated age).
export function formatAgo(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

// Resolve the honest label + visual tone + (for stale) age string.
export function resolveSource({
  priceSource,
  observedAt,
  nowMs,
  staleAfterMs = STALE_FALLBACK_MS,
}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const observed = observedAt ? new Date(observedAt).getTime() : null;
  const isFresh = observed != null && now - observed <= staleAfterMs;

  if (priceSource === 'panta_live') {
    if (isFresh) return { label: 'Live · Panta', tone: 'live', age: null };
    return { label: 'Stale · Panta', tone: 'stale', age: formatAgo(observedAt, now) };
  }
  if (priceSource === 'stale_panta') {
    return { label: 'Stale · Panta', tone: 'stale', age: formatAgo(observedAt, now) };
  }
  return { label: 'Simulated', tone: 'simulated', age: null };
}
