import { fmtTimeLeft } from './format.js';

// ---------------------------------------------------------------------------
// The single source of truth for "is there a real countdown to show?" — shared
// by MarketCard's pill and Discover's "Closing soon" rail filter so the two can
// never diverge (a rail slot with no ticking pill, or a pill on a closed bet).
// Returns the countdown text, or null when NO pill may render: market absent /
// not open / no end_time, or the fmtTimeLeft honesty clamp says "—" (absent,
// past, or beyond 48h — see docs/live-aggregation-spec.md §4: never fake it).
// ---------------------------------------------------------------------------
export function countdownPill(hero) {
  if (!hero || hero.status !== 'open' || !hero.end_time) return null;
  const text = fmtTimeLeft(hero.end_time);
  return text === '—' ? null : text;
}

// The 1s heartbeat that makes a visible countdown actually TICK: fmtTimeLeft
// reads Date.now() at render, so a card only moves if something re-renders it.
// Calls notify() every COUNTDOWN_TICK_MS and returns an idempotent stop().
// Timers are injectable so tests prove the cadence without real waiting.
export const COUNTDOWN_TICK_MS = 1000;

export function startCountdownTick(notify, { setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  let active = true;
  const handle = setIntervalImpl(() => {
    if (active) notify();
  }, COUNTDOWN_TICK_MS);
  return () => {
    if (!active) return;
    active = false;
    clearIntervalImpl(handle);
  };
}
