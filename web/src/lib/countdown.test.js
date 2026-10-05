import { describe, it, expect, vi, afterEach } from 'vitest';
import { countdownPill, startCountdownTick, COUNTDOWN_TICK_MS } from './countdown.js';

// ---------------------------------------------------------------------------
// The live-feel round made countdowns TICK on the landing rails. The pill
// decision + the 1s heartbeat now live in lib/countdown.js (pure), so both
// halves of "it actually counts down" are provable WITHOUT a DOM:
//   1. countdownPill agrees with the fmtTimeLeft honesty clamp (§4: never a
//      fake countdown on far-future seeds, closed bets, or missing data);
//   2. the tick fires every second, stops cleanly, and the rendered text
//      strictly decreases as wall-clock time advances.
// ---------------------------------------------------------------------------

const MIN = 60 * 1000;

describe('countdownPill — one predicate for pill + Closing-soon rail', () => {
  it('shows nothing for absent / closed / end_time-less markets', () => {
    expect(countdownPill(undefined)).toBeNull();
    expect(countdownPill(null)).toBeNull();
    expect(countdownPill({ status: 'closed', end_time: new Date(Date.now() + MIN).toISOString() })).toBeNull();
    expect(countdownPill({ status: 'resolved', end_time: new Date(Date.now() + MIN).toISOString() })).toBeNull();
    expect(countdownPill({ status: 'open' })).toBeNull();
    expect(countdownPill({ status: 'open', end_time: '' })).toBeNull();
  });

  it('honest clamp: past or far-future end times render NO pill (the 2099 seed class)', () => {
    expect(countdownPill({ status: 'open', end_time: new Date(Date.now() - 1000).toISOString() })).toBeNull();
    expect(countdownPill({ status: 'open', end_time: '2099-12-31T00:00:00.000Z' })).toBeNull();
    expect(countdownPill({ status: 'open', end_time: 'not a date' })).toBeNull();
  });

  it('a genuinely-open, sub-48h market gets a "Nm Ns" pill', () => {
    const hero = { status: 'open', end_time: new Date(Date.now() + 29 * MIN).toISOString() };
    expect(countdownPill(hero)).toMatch(/^\d+m \d+s$/);
  });
});

describe('startCountdownTick — the heartbeat that makes the pill move', () => {
  afterEach(() => vi.useRealTimers());

  it('fires notify every 1000ms via the injected timers and clears on stop', () => {
    const handles = [];
    let cb = null;
    const setIntervalImpl = (fn, ms) => {
      expect(ms).toBe(COUNTDOWN_TICK_MS);
      cb = fn;
      handles.push(ms);
      return 'h1';
    };
    const cleared = [];
    const clearIntervalImpl = (h) => cleared.push(h);
    let fired = 0;
    const stop = startCountdownTick(() => (fired += 1), { setIntervalImpl, clearIntervalImpl });
    expect(handles).toEqual([1000]);
    cb(); cb(); cb();
    expect(fired).toBe(3);
    stop();
    expect(cleared).toEqual(['h1']);
    cb(); // a late fire after stop must NEVER notify
    expect(fired).toBe(3);
    stop(); // idempotent
    expect(cleared).toEqual(['h1']);
  });

  it('the pill text STRICTLY DECREASES as real time advances (proves it ticks)', () => {
    vi.useFakeTimers();
    const base = Date.UTC(2026, 9, 5, 0, 0, 0);
    vi.setSystemTime(base);
    const hero = { status: 'open', end_time: new Date(base + 30 * MIN).toISOString() };
    const first = countdownPill(hero);
    vi.advanceTimersByTime(5000); // five heartbeat steps
    const second = countdownPill(hero);
    const secs = (t) => {
      const m = /(\d+)m (\d+)s/.exec(t);
      return Number(m[1]) * 60 + Number(m[2]);
    };
    expect(secs(second)).toBeLessThanOrEqual(secs(first) - 5);
    vi.useRealTimers();
  });
});
