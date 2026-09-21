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
