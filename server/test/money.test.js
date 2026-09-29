import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { round6, toMicro, fromMicro, microBps, bpsFee, MICRO } from '../src/lib/money.js';

// F-009: money that moves balances must be computed in exact integer
// micro-units so no binary-float residue can leak into a stored amount.
describe('money micro-unit math', () => {
  it('toMicro/fromMicro round-trip clean values', () => {
    for (const v of [0, 1, 2.5, 0.07, 99.99, 1234.5678]) {
      assert.equal(fromMicro(toMicro(v)), v);
    }
  });

  it('every fee lands on an exact micro boundary (no float residue)', () => {
    const bps = 200;
    for (let cents = 1; cents <= 5000; cents++) {
      const amount = cents / 100;
      const fee = bpsFee(amount, bps);
      // A stored fee must be representable as a whole number of micros.
      assert.ok(
        Number.isInteger(toMicro(fee)),
        `fee ${fee} for amount ${amount} is not a clean micro value`,
      );
    }
  });

  it('microBps scales exactly for divisible inputs', () => {
    // 100.00 = 100_000_000 micros * 200 bps / 10000 = 2_000_000 micros = $2.
    assert.equal(microBps(toMicro(100), 200), 2 * MICRO);
    assert.equal(bpsFee(100, 200), 2);
    // creator share: 20% of a $2 fee.
    assert.equal(bpsFee(2, 2000), 0.4);
  });

  it('microBps rounds half-up at the exact tie boundary', () => {
    // 25 micros * 200 bps = 5000; 5000 % 10000 == 5000 -> tie -> round up to 1.
    assert.equal(microBps(25, 200), 1);
    // Just below the tie stays down.
    assert.equal(microBps(24, 200), 0);
  });

  it('matches round6 for typical inputs but is exact for float-hostile ones', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in binary float.
    const amount = 0.1 + 0.2;
    const viaMicro = bpsFee(amount, 200);
    const viaFloat = round6((amount * 200) / 10000);
    // The micro path snaps to the intended clean 0.006; both agree at 6dp.
    assert.equal(toMicro(viaMicro), 6000);
    assert.equal(fromMicro(toMicro(viaMicro)), viaFloat);
  });

  it('fee + net conserves the amount at micro precision', () => {
    for (const amount of [1.23, 5.0, 47.77, 100.01, 0.07]) {
      const fee = bpsFee(amount, 200);
      const net = round6(amount - fee);
      assert.equal(toMicro(fee) + toMicro(net), toMicro(amount));
    }
  });
});
