import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cost, priceYes, priceNo, sharesForSpend } from '../src/sim/lmsr.js';

describe('lmsr', ()=>{
  it('price 0.5 at zero state', ()=>{
    assert.equal(priceYes(0,0,50), 0.5);
    assert.equal(priceNo(0,0,50), 0.5);
  });
  it('buying YES raises YES price', ()=>{
    const b=50;
    const p0 = priceYes(0,0,b);
    const s = sharesForSpend(0,0,'yes',5,b);
    const p1 = priceYes(s,0,b);
    assert.ok(p1 > p0);
  });
  it('cost delta equals spend', ()=>{
    const b=50;
    const c0 = cost(0,0,b);
    const s = sharesForSpend(0,0,'yes',4.9,b);
    const c1 = cost(s,0,b);
    assert.ok(Math.abs((c1-c0)-4.9) < 1e-6);
  });
  it('shares positive and monotonic', ()=>{
    const b=50;
    const s1 = sharesForSpend(0,0,'yes',1,b);
    const s2 = sharesForSpend(0,0,'yes',5,b);
    assert.ok(s1>0 && s2>s1);
  });
  it('extreme sizes no NaN', ()=>{
    const b=50;
    const s = sharesForSpend(1000,0,'yes',10000,b);
    assert.ok(isFinite(s) && !isNaN(s));
  });
});

describe('lmsr prior (Gemini opening line)', ()=>{
  const b = 50;
  it('prior 0.5 / null delegates byte-for-byte to the uniform math', ()=>{
    assert.equal(priceYes(0,0,b,0.5), priceYes(0,0,b));
    assert.equal(priceYes(0,0,b,null), priceYes(0,0,b));
    assert.equal(priceYes(3,1,b,0.5), priceYes(3,1,b));
    assert.equal(cost(0,0,b,0.5), cost(0,0,b));
    assert.equal(sharesForSpend(0,0,'yes',5,b,0.5), sharesForSpend(0,0,'yes',5,b));
    assert.equal(sharesForSpend(2,0,'no',4,b,null), sharesForSpend(2,0,'no',4,b));
  });
  it('opens exactly at the prior line (price at q=0 == prior)', ()=>{
    assert.ok(Math.abs(priceYes(0,0,b,0.9) - 0.9) < 1e-9);
    assert.ok(Math.abs(priceNo(0,0,b,0.9) - 0.1) < 1e-9);
    assert.ok(Math.abs(priceYes(0,0,b,0.2) - 0.2) < 1e-9);
  });
  it('spend-then-reprice round-trips on the prior curve (cost delta == net)', ()=>{
    const prior = 0.72;
    const net = 4.9;
    const s = sharesForSpend(0,0,'yes',net,b,prior);
    const c0 = cost(0,0,b,prior);
    const c1 = cost(s,0,b,prior);
    assert.ok(Math.abs((c1-c0)-net) < 1e-6, 'buy YES: cost delta equals spend');
    // buying on the prior curve still moves YES price up from the opening line
    assert.ok(priceYes(s,0,b,prior) > prior);
    // NO side round-trips too
    const sn = sharesForSpend(0,0,'no',net,b,prior);
    const cn = cost(0,sn,b,prior);
    assert.ok(Math.abs((cn-c0)-net) < 1e-6, 'buy NO: cost delta equals spend');
  });
  it('extreme prior + big buy stays finite', ()=>{
    const s = sharesForSpend(1000,0,'yes',10000,b,0.95);
    assert.ok(isFinite(s) && !isNaN(s));
    assert.ok(isFinite(priceYes(0,0,b,0.05)) && isFinite(priceYes(0,0,b,0.95)));
    assert.ok(isFinite(cost(500,500,b,0.9)));
  });
});
