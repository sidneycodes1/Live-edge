import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  withTimeout,
  retry,
  createCircuitBreaker,
  createBulkhead,
  createProviderRunner,
  isRetryable,
} from '../src/aggregator/resilience.js';
import { ProviderError } from '../src/aggregator/errors.js';

// These tests use a fake clock (injected `now`) so the 30s breaker cooldown is
// instant, and tiny real timers for the timeout so nothing hangs the suite.

describe('isRetryable', () => {
  it('retries timeouts, network, and 5xx — but not 4xx/creds/limiter errors', () => {
    assert.equal(isRetryable(new ProviderError('TIMEOUT', 'x')), true);
    assert.equal(isRetryable(new ProviderError('NETWORK', 'x')), true);
    assert.equal(isRetryable(new ProviderError('HTTP_ERROR', 'x', { status: 503 })), true);
    assert.equal(isRetryable(new ProviderError('HTTP_ERROR', 'x', { status: 404 })), false);
    assert.equal(isRetryable(new ProviderError('MISSING_CREDENTIALS', 'x')), false);
    assert.equal(isRetryable(new ProviderError('CIRCUIT_OPEN', 'x')), false);
    assert.equal(isRetryable(new Error('plain')), false);
  });
});

describe('withTimeout', () => {
  it('resolves when the thunk beats the deadline', async () => {
    const v = await withTimeout(async () => 'ok', { ms: 200 });
    assert.equal(v, 'ok');
  });

  it('rejects with a TIMEOUT ProviderError when it is too slow', async () => {
    const slow = () => new Promise((r) => setTimeout(() => r('late'), 200));
    await assert.rejects(() => withTimeout(slow, { ms: 5 }), (err) => {
      assert.equal(err.code, 'TIMEOUT');
      assert.ok(err instanceof ProviderError);
      return true;
    });
  });
});

describe('retry', () => {
  it('retries once on a retryable error then returns the success', async () => {
    let calls = 0;
    const thunk = async () => {
      calls += 1;
      if (calls === 1) throw new ProviderError('HTTP_ERROR', 'boom', { status: 503 });
      return 'recovered';
    };
    const v = await retry(thunk, { retries: 1 });
    assert.equal(v, 'recovered');
    assert.equal(calls, 2);
  });

  it('does NOT retry a non-retryable error (single attempt)', async () => {
    let calls = 0;
    const thunk = async () => {
      calls += 1;
      throw new ProviderError('HTTP_ERROR', 'bad request', { status: 400 });
    };
    await assert.rejects(() => retry(thunk, { retries: 1 }));
    assert.equal(calls, 1);
  });

  it('gives up after exhausting retries with the last error', async () => {
    let calls = 0;
    const thunk = async () => {
      calls += 1;
      throw new ProviderError('NETWORK', 'down');
    };
    await assert.rejects(() => retry(thunk, { retries: 1 }));
    assert.equal(calls, 2, 'original + 1 retry');
  });
});

describe('createCircuitBreaker', () => {
  function failing() {
    return async () => {
      throw new ProviderError('NETWORK', 'down');
    };
  }

  it('opens after 3 consecutive failures and fails fast (no call) while open', async () => {
    let nowVal = 1000;
    const b = createCircuitBreaker({ now: () => nowVal });
    for (let i = 0; i < 3; i += 1) await assert.rejects(() => b.execute(failing()));
    assert.equal(b._state(), 'open');
    let tried = false;
    await assert.rejects(
      () =>
        b.execute(async () => {
          tried = true;
          return 'x';
        }),
      (err) => err.code === 'CIRCUIT_OPEN',
    );
    assert.equal(tried, false, 'open breaker must not call the provider');
  });

  it('a success resets the failure budget before the threshold is hit', async () => {
    const b = createCircuitBreaker();
    await assert.rejects(() => b.execute(failing()));
    await assert.rejects(() => b.execute(failing()));
    await b.execute(async () => 'ok');
    assert.equal(b._state(), 'closed');
    assert.equal(b._failures(), 0);
  });

  it('after cooldown it half-opens; a success closes it again', async () => {
    let nowVal = 0;
    const b = createCircuitBreaker({ cooldownMs: 30000, now: () => nowVal });
    for (let i = 0; i < 3; i += 1) await assert.rejects(() => b.execute(failing()));
    assert.equal(b._state(), 'open');
    nowVal = 30001; // cooldown elapsed
    await b.execute(async () => 'ok'); // half-open trial succeeds
    assert.equal(b._state(), 'closed');
  });

  it('a failed half-open trial re-opens for a fresh cooldown', async () => {
    let nowVal = 0;
    const b = createCircuitBreaker({ cooldownMs: 30000, now: () => nowVal });
    for (let i = 0; i < 3; i += 1) await assert.rejects(() => b.execute(failing()));
    nowVal = 30001;
    await assert.rejects(() => b.execute(failing())); // half-open trial fails
    assert.equal(b._state(), 'open');
    // still open immediately after → fails fast
    await assert.rejects(() => b.execute(failing()), (err) => err.code === 'CIRCUIT_OPEN');
  });
});

describe('createBulkhead', () => {
  it('caps concurrency at the limit and fail-fasts beyond it', async () => {
    const bh = createBulkhead({ limit: 2 });
    let peak = 0;
    const gate = () =>
      new Promise((res) => {
        setTimeout(res, 20);
      });
    const tracked = async () => {
      peak = Math.max(peak, bh._active());
      await gate();
      return 'done';
    };
    const a = bh.run(tracked);
    const b = bh.run(tracked);
    // third slot is full → fail-fast rejection
    await assert.rejects(() => bh.run(tracked, { failFast: true }), (err) => err.code === 'BULKHEAD_REJECTED');
    await Promise.all([a, b]);
    assert.ok(peak <= 2, `peak active ${peak} must be <= limit 2`);
  });

  it('without failFast a queued call runs once a slot frees', async () => {
    const bh = createBulkhead({ limit: 1 });
    const order = [];
    // p1 is invoked FIRST so it takes the only slot and holds it across its await;
    // p2 then sees the cap and must wait for the release.
    const p1 = bh.run(async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('first-end');
      return 1;
    });
    const p2 = bh.run(async () => {
      order.push('second');
      return 2;
    });
    const [x, y] = await Promise.all([p1, p2]);
    assert.equal(x, 1);
    assert.equal(y, 2);
    assert.deepEqual(order, ['first-start', 'first-end', 'second'], 'second waited for the slot');
  });
});

describe('createProviderRunner', () => {
  it('runSafe never throws — a failing provider degrades to the fallback', async () => {
    const runner = createProviderRunner({ name: 'kick', warn: () => {} });
    const r = await runner.runSafe(async () => {
      throw new ProviderError('HTTP_ERROR', 'up', { status: 500 });
    }, []);
    assert.equal(r.ok, false);
    assert.equal(r.degraded, true);
    assert.equal(r.reason, 'HTTP_ERROR');
    assert.deepEqual(r.value, []);
  });

  it('runSafe passes through a healthy provider result', async () => {
    const runner = createProviderRunner({ name: 'twitch' });
    const r = await runner.runSafe(async () => [{ id: 'twitch:1' }], []);
    assert.equal(r.ok, true);
    assert.equal(r.degraded, false);
    assert.equal(r.value.length, 1);
  });

  it('a persistently failing provider trips its breaker → CIRCUIT_OPEN reason on runSafe', async () => {
    let nowVal = 0;
    const runner = createProviderRunner({
      name: 'kick',
      warn: () => {},
      breaker: createCircuitBreaker({ now: () => nowVal }),
    });
    const boom = () => runner.runSafe(async () => {
      throw new ProviderError('NETWORK', 'down');
    }, []);
    // 3 run-safe failures (each retries once internally, still a failure) → open
    await boom();
    await boom();
    await boom();
    const after = await boom();
    assert.equal(after.reason, 'CIRCUIT_OPEN', '4th call short-circuited by the breaker');
  });
});
