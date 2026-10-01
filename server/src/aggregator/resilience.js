import { ProviderError } from './errors.js';

// ---------------------------------------------------------------------------
// Resilience primitives for the multi-source live feed. Each provider call in
// ../aggregator/index.js is wrapped (outside→inside) in:
//   bulkhead(≤3 concurrent, fail-fast) → circuit-breaker(3 fails → 30s open)
//     → retry(1) → timeout(2.5s) → the real fetch thunk.
//
// Rationale for the ordering: the bulkhead is the outermost guard so a saturated
// provider sheds load immediately (fail-fast) instead of queueing and stalling the
// landing grid; the breaker sits inside it so a rejected call never (wrongly)
// counts toward the failure budget; retry is inside the breaker so a single
// transient blip doesn't trip the breaker; and the timeout is innermost so BOTH
// the original attempt and its one retry each get their own budget.
//
// All of this is deliberately dependency-free (no p-retry/cockatiel): the repo's
// only HTTP primitive is the global fetch already used by ../twitch/client.js, and
// keeping it hand-rolled means every behavior here is unit-testable with an
// injected clock. Nothing in this file throws for "control flow" reasons that the
// caller can't observe as a ProviderError code.
// ---------------------------------------------------------------------------

// Default budgets, overridable per runner. Kept here so both the aggregator and
// tests reference one source of truth.
export const TIMEOUT_MS = 2500;
export const RETRIES = 1;
export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 30000;
export const BULKHEAD_LIMIT = 3;

// Which failures are worth a second attempt: transport errors, timeouts, and 5xx
// (upstream trouble). NOT 4xx / missing creds / circuit-open / bulkhead-rejected —
// retrying those only wastes the request budget and delays the grid.
export function isRetryable(err) {
  if (!err) return false;
  if (err.code === 'TIMEOUT' || err.code === 'NETWORK') return true;
  if (err.code === 'HTTP_ERROR' && Number.isFinite(err.status)) {
    return err.status >= 500 && err.status < 600;
  }
  return false;
}

// Race `thunk` against `ms`. Uses a real timer and always clears it so a resolved
// first doesn't leave a dangling handle (which would keep the process / tests alive).
export function withTimeout(thunk, { ms = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ProviderError('TIMEOUT', `provider call timed out (${ms}ms)`, { status: 504 }));
    }, ms);
    const done = (fn) => (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    Promise.resolve()
      .then(thunk)
      .then(done(resolve), done(reject));
  });
}

// At most `retries` EXTRA attempts (retries:1 → up to 2 tries total). Immediate
// (no backoff) — for a 2.5s-budget landing grid a fast second try beats waiting.
export async function retry(thunk, { retries = RETRIES, shouldRetry = isRetryable } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await thunk();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !shouldRetry(err)) break;
    }
  }
  throw lastErr;
}

// 3 consecutive failures → open for 30s. While open, calls fail fast with a
// CIRCUIT_OPEN ProviderError (never touching the network). After the cooldown the
// next call runs as a half-open trial: success closes the breaker, failure re-opens
// it for another full cooldown. `now` is injectable so cooldown is testable w/o a
// real 30s wait.
export function createCircuitBreaker({
  threshold = BREAKER_THRESHOLD,
  cooldownMs = BREAKER_COOLDOWN_MS,
  now = () => Date.now(),
} = {}) {
  let failures = 0;
  let openedAt = null; // set while open/half-open; cleared on close
  let halfOpen = false;

  function state() {
    if (openedAt === null) return 'closed';
    return halfOpen ? 'half-open' : 'open';
  }

  async function execute(thunk) {
    if (openedAt !== null && !halfOpen) {
      if (now() - openedAt < cooldownMs) {
        throw new ProviderError('CIRCUIT_OPEN', 'circuit open — skipping provider', { status: 503 });
      }
      halfOpen = true; // cooldown elapsed → allow a single trial
    }
    try {
      const value = await thunk();
      // success fully resets the budget
      failures = 0;
      openedAt = null;
      halfOpen = false;
      return value;
    } catch (err) {
      if (halfOpen) {
        // trial failed → re-open for another cooldown
        openedAt = now();
        halfOpen = false;
      } else {
        failures += 1;
        if (failures >= threshold) {
          openedAt = now();
        }
      }
      throw err;
    }
  }

  return { execute, _state: state, _failures: () => failures };
}

// A counting semaphore. `run(thunk, { failFast })`: if fewer than `limit` are in
// flight, take a slot and go; otherwise either reject immediately (failFast — the
// aggregator's choice, so a slow provider can't block the grid) or wait for the
// next free slot. Slots are always released, even on throw.
export function createBulkhead({ limit = BULKHEAD_LIMIT } = {}) {
  let active = 0;
  const waiters = [];

  function release() {
    active -= 1;
    const next = waiters.shift();
    if (next) {
      active += 1;
      next();
    }
  }

  async function run(thunk, { failFast = false } = {}) {
    if (active >= limit) {
      if (failFast) {
        throw new ProviderError('BULKHEAD_REJECTED', 'provider concurrency cap reached', { status: 503 });
      }
      await new Promise((res) => waiters.push(res));
    } else {
      active += 1;
    }
    try {
      return await thunk();
    } finally {
      release();
    }
  }

  return { run, _active: () => active };
}

// Compose the four guards for a single provider. `run` throws a ProviderError on
// any failure; `runSafe` converts that into an { ok, value, degraded } result so
// the aggregator can keep merging other sources and still report per-source status
// without any provider being able to 500 the whole grid.
export function createProviderRunner({
  name,
  timeoutMs = TIMEOUT_MS,
  retries = RETRIES,
  shouldRetry = isRetryable,
  breaker = createCircuitBreaker(),
  bulkhead = createBulkhead(),
  warn = (msg) => console.warn(msg),
} = {}) {
  async function run(thunk) {
    const guarded = () => retry(() => withTimeout(thunk, { ms: timeoutMs }), { retries, shouldRetry });
    return bulkhead.run(() => breaker.execute(guarded), { failFast: true });
  }

  async function runSafe(thunk, fallback = []) {
    try {
      const value = await run(thunk);
      return { ok: true, value, degraded: false };
    } catch (err) {
      const code = err?.code || 'ERROR';
      // Only warn for genuinely actionable states; a fail-fast rejection on a busy
      // grid is expected and shouldn't spam logs at info level.
      if (code !== 'BULKHEAD_REJECTED') {
        warn(`live provider ${name} degraded (${code})`);
      }
      return { ok: false, value: fallback, degraded: true, reason: code };
    }
  }

  return { run, runSafe, name, _breaker: breaker, _bulkhead: bulkhead };
}
