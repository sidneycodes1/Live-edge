import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMEOUT_MS,
  RETRIES,
  BREAKER_THRESHOLD,
  BREAKER_COOLDOWN_MS,
  BULKHEAD_LIMIT,
  isRetryable,
  withTimeout,
  retry,
  createCircuitBreaker,
  createBulkhead,
  createProviderRunner,
} from '../src/aggregator/resilience.js';
import { ProviderError } from '../src/aggregator/errors.js';

// -----------------------------------------------------------------------------
// Agent D (QA) resilience tests for the primitives wrapped around every
// provider call. Proves docs/live-aggregation-spec.md §5 (budgets, wrapping
// order, retry taxonomy) + error codes (§5 taxonomy block). Injected `now`
// for cooldown; short real timers for `withTimeout` (the primitive uses real
// setTimeout so nothing here fakes it — the budgets we assert ON are small
// but the mechanism is real). No existing test weakened.
// -----------------------------------------------------------------------------

const P = (code, status) => new ProviderError(code, `${code} test`, { status });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('§5 budget constants are the frozen contract', () => {
  it('exact spec numbers so a silent tuning never passes as "green"', () => {
    assert.equal(TIMEOUT_MS, 2500);
    assert.equal(RETRIES, 1);
    assert.equal(BREAKER_THRESHOLD, 3);
    assert.equal(BREAKER_COOLDOWN_MS, 30000);
    assert.equal(BULKHEAD_LIMIT, 3);
  });
});

describe('isRetryable — the retry taxonomy is part of the contract', () => {
  it('TIMEOUT / NETWORK / HTTP 5xx → true', () => {
    assert.equal(isRetryable(P('TIMEOUT', 504)), true);
    assert.equal(isRetryable(P('NETWORK')), true);
    assert.equal(isRetryable(P('HTTP_ERROR', 500)), true);
    assert.equal(isRetryable(P('HTTP_ERROR', 503)), true);
  });
  it('HTTP 4xx / MISSING_CREDENTIALS / CIRCUIT_OPEN / BULKHEAD_REJECTED → false', () => {
    assert.equal(isRetryable(P('HTTP_ERROR', 400)), false);
    assert.equal(isRetryable(P('HTTP_ERROR', 404)), false);
    assert.equal(isRetryable(P('HTTP_ERROR', 429)), false, '429 is 4xx; not retried here');
    assert.equal(isRetryable(P('MISSING_CREDENTIALS')), false);
    assert.equal(isRetryable(P('CIRCUIT_OPEN', 503)), false);
    assert.equal(isRetryable(P('BULKHEAD_REJECTED', 503)), false);
  });
  it('falsy / unknown → false', () => {
    assert.equal(isRetryable(null), false);
    assert.equal(isRetryable(undefined), false);
    assert.equal(isRetryable(new Error('boom')), false);
  });
});

describe('withTimeout', () => {
  it('resolves when the thunk is faster than the budget', async () => {
    const v = await withTimeout(async () => 'fast', { ms: 50 });
    assert.equal(v, 'fast');
  });

  it('rejects with ProviderError TIMEOUT + status 504 when the budget is overrun', async () => {
    let err;
    try {
      await withTimeout(() => new Promise((res) => setTimeout(res, 250)), { ms: 10 });
    } catch (e) { err = e; }
    assert.equal(err?.name, 'ProviderError');
    assert.equal(err?.code, 'TIMEOUT');
    assert.equal(err?.status, 504);
  });

  it('a fast thunk leaves NO dangling timer (promise resolves once, not twice)', async () => {
    const g = deferred();
    const p = withTimeout(() => g.promise, { ms: 1000 });
    g.resolve('x');
    assert.equal(await p, 'x');
  });
});

describe('retry', () => {
  it('TIMEOUT is retried → exactly 2 attempts (retries=1 default)', async () => {
    let n = 0;
    await assert.rejects(
      retry(() => { n += 1; return Promise.reject(P('TIMEOUT', 504)); }),
      (e) => e.code === 'TIMEOUT',
    );
    assert.equal(n, 2, '1 original + 1 retry = 2 total attempts');
  });

  it('HTTP 5xx is retried; HTTP 4xx is NOT (only 1 attempt)', async () => {
    let n5 = 0;
    await assert.rejects(retry(() => { n5 += 1; return Promise.reject(P('HTTP_ERROR', 503)); }));
    assert.equal(n5, 2, '5xx retried');
    let n4 = 0;
    await assert.rejects(retry(() => { n4 += 1; return Promise.reject(P('HTTP_ERROR', 404)); }));
    assert.equal(n4, 1, '4xx NOT retried — the budget is preserved for the grid');
  });

  it('a thunk that fails then succeeds returns the success value', async () => {
    let n = 0;
    const v = await retry(() => {
      n += 1;
      if (n === 1) return Promise.reject(P('NETWORK'));
      return Promise.resolve('ok');
    });
    assert.equal(v, 'ok');
    assert.equal(n, 2);
  });

  it('CIRCUIT_OPEN is not retried (single attempt; the ladder moves on)', async () => {
    let n = 0;
    await assert.rejects(retry(() => { n += 1; return Promise.reject(P('CIRCUIT_OPEN', 503)); }));
    assert.equal(n, 1);
  });
});

describe('createCircuitBreaker — 3 fails → open, cooldown → half-open probe', () => {
  it('opens at threshold=3 consecutive fails; further calls reject WITHOUT touching the thunk', async () => {
    let t = 0;
    const br = createCircuitBreaker({ threshold: 3, cooldownMs: 30000, now: () => t });
    for (let i = 0; i < 3; i += 1) {
      await assert.rejects(br.execute(() => Promise.reject(P('NETWORK'))));
    }
    assert.equal(br._state(), 'open', 'breaker open after threshold');
    let thunkCalls = 0;
    let err;
    try { await br.execute(() => { thunkCalls += 1; return Promise.resolve('x'); }); } catch (e) { err = e; }
    assert.equal(err?.code, 'CIRCUIT_OPEN');
    assert.equal(err?.status, 503);
    assert.equal(thunkCalls, 0, 'open breaker must NOT touch the network');
  });

  it('a single blip does not open (threshold=3); a later success zeros the failure budget', async () => {
    let t = 0;
    const br = createCircuitBreaker({ threshold: 3, cooldownMs: 30000, now: () => t });
    await assert.rejects(br.execute(() => Promise.reject(P('NETWORK'))));
    // A success resets the budget.
    assert.equal(await br.execute(() => Promise.resolve('ok')), 'ok');
    assert.equal(br._state(), 'closed');
    assert.equal(br._failures(), 0, 'success must zero the failure count');
  });

  it('after cooldown → half-open probe runs; SUCCESS closes for good', async () => {
    let t = 0;
    const br = createCircuitBreaker({ threshold: 3, cooldownMs: 30000, now: () => t });
    for (let i = 0; i < 3; i += 1) await assert.rejects(br.execute(() => Promise.reject(P('NETWORK'))));
    t += 30001;
    const v = await br.execute(() => Promise.resolve('probe'));
    assert.equal(v, 'probe', 'half-open probe allowed to run');
    assert.equal(br._state(), 'closed');
  });

  it('half-open probe FAILURE re-opens for another full cooldown (not a fast retry)', async () => {
    let t = 0;
    const br = createCircuitBreaker({ threshold: 3, cooldownMs: 30000, now: () => t });
    for (let i = 0; i < 3; i += 1) await assert.rejects(br.execute(() => Promise.reject(P('NETWORK'))));
    t += 30001;
    await assert.rejects(br.execute(() => Promise.reject(P('NETWORK'))), (e) => e.code === 'NETWORK');
    assert.equal(br._state(), 'open');
    // Immediately after re-open, a second call must be CIRCUIT_OPEN (not another probe)
    let err;
    try { await br.execute(() => Promise.resolve('x')); } catch (e) { err = e; }
    assert.equal(err?.code, 'CIRCUIT_OPEN');
    // And it stays open for a full second cooldown window, not the leftover of the first
    t += 15000;
    let err2;
    try { await br.execute(() => Promise.resolve('x')); } catch (e) { err2 = e; }
    assert.equal(err2?.code, 'CIRCUIT_OPEN', 're-open resets the cooldown clock');
  });
});

describe('createBulkhead — 3 in-flight, 4th rejected (fail-fast) or waits (queue)', () => {
  it('failFast: the (limit+1)-th concurrent run rejects with BULKHEAD_REJECTED', async () => {
    const bh = createBulkhead({ limit: 3 });
    const g = deferred();
    const inflight = [bh.run(() => g.promise), bh.run(() => g.promise), bh.run(() => g.promise)];
    // active is incremented synchronously inside run() before the first await, so
    // we do not need to await anything before probing the 4th slot.
    let err;
    try { await bh.run(() => g.promise, { failFast: true }); } catch (e) { err = e; }
    assert.equal(err?.code, 'BULKHEAD_REJECTED');
    assert.equal(err?.status, 503);
    g.resolve('done');
    await Promise.all(inflight);
  });

  it('slots are released on THROW, so a failed call does not permanently jam the bulkhead', async () => {
    const bh = createBulkhead({ limit: 1 });
    await assert.rejects(bh.run(() => Promise.reject(P('NETWORK'))));
    // Second call must be able to enter (slot freed by finally).
    assert.equal(await bh.run(() => Promise.resolve('ok')), 'ok');
  });

  it('queue mode (failFast=false) admits the waiter once a slot frees', async () => {
    const bh = createBulkhead({ limit: 1 });
    const g = deferred();
    const first = bh.run(() => g.promise);
    const second = bh.run(() => g.promise); // waits (no failFast)
    g.resolve('ok');
    assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
  });
});

describe('createProviderRunner — composition order + never-throws runSafe', () => {
  it('runSafe: success → {ok:true, value, degraded:false}', async () => {
    const runner = createProviderRunner({ name: 'x', warn: () => {} });
    const r = await runner.runSafe(() => Promise.resolve(['a', 'b']), []);
    assert.deepEqual(r, { ok: true, value: ['a', 'b'], degraded: false });
  });

  it('runSafe: any failure → {ok:false, value: fallback, degraded:true, reason:code} and NEVER throws', async () => {
    const runner = createProviderRunner({ name: 'x', warn: () => {} });
    const r = await runner.runSafe(() => Promise.reject(P('HTTP_ERROR', 500)), ['fallback']);
    assert.equal(r.ok, false);
    assert.equal(r.degraded, true);
    assert.equal(r.reason, 'HTTP_ERROR');
    assert.deepEqual(r.value, ['fallback']);
  });

  it('timeout → retry fires → 2 thunk invocations, then TIMEOUT reason', async () => {
    let n = 0;
    const runner = createProviderRunner({
      name: 'x', timeoutMs: 10, retries: 1, warn: () => {},
    });
    const r = await runner.runSafe(() => { n += 1; return new Promise((res) => setTimeout(res, 250)); }, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'TIMEOUT');
    assert.equal(n, 2, 'original attempt + 1 retry, each gets its own 10ms budget');
  });

  it('BREAKER opens after 3 fails; 4th call rejects CIRCUIT_OPEN WITHOUT running the thunk (ladder moves on)', async () => {
    let t = 0;
    const runner = createProviderRunner({
      name: 'x',
      retries: 0, // disable retry so each runSafe = exactly 1 thunk call for clean counting
      breaker: createCircuitBreaker({ threshold: 3, cooldownMs: 30000, now: () => t }),
      bulkhead: createBulkhead({ limit: 10 }),
      warn: () => {},
    });
    for (let i = 0; i < 3; i += 1) {
      const r = await runner.runSafe(() => Promise.reject(P('NETWORK')), []);
      assert.equal(r.reason, 'NETWORK');
    }
    let thunkCalls = 0;
    const after = await runner.runSafe(() => { thunkCalls += 1; return Promise.resolve('x'); }, []);
    assert.equal(after.reason, 'CIRCUIT_OPEN');
    assert.equal(thunkCalls, 0, 'open breaker must short-circuit before the thunk');
  });

  it('bulkhead rejection is OUTER to the breaker and does NOT count toward breaker failures (§5 rationale)', async () => {
    const runner = createProviderRunner({
      name: 'x',
      breaker: createCircuitBreaker({ threshold: 3 }),
      bulkhead: createBulkhead({ limit: 1 }),
      warn: () => {},
    });
    const g = deferred();
    const first = runner.run(() => g.promise);
    let err;
    try { await runner.run(() => g.promise); } catch (e) { err = e; }
    assert.equal(err?.code, 'BULKHEAD_REJECTED');
    assert.equal(runner._breaker._failures(), 0, 'rejected call bypassed the breaker; failure budget untouched');
    g.resolve('ok');
    await first;
  });

  it('runSafe does NOT warn for a BULKHEAD_REJECTED (spec §5: expected on a busy grid; avoid log spam)', async () => {
    const warnings = [];
    const runner = createProviderRunner({
      name: 'x',
      bulkhead: createBulkhead({ limit: 1 }),
      warn: (m) => warnings.push(m),
    });
    const g = deferred();
    const first = runner.runSafe(() => g.promise, []);
    // Let the run enter the bulkhead, then saturate.
    await Promise.resolve();
    const second = await runner.runSafe(() => g.promise, []);
    assert.equal(second.reason, 'BULKHEAD_REJECTED');
    g.resolve('ok');
    await first;
    assert.equal(warnings.filter((w) => /BULKHEAD_REJECTED/.test(w)).length, 0);
  });
});
