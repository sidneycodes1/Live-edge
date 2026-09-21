import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveClient } from '../src/panta/liveClient.js';
import { loadEnv } from '../src/config/env.js';

describe('liveClient', ()=>{
  it('trailing slash builder', ()=>{
    const c=createLiveClient({baseUrl:'https://x.example/api/v1', apiKey:'k', fetchImpl: async()=> new Response(JSON.stringify({}), {status:200})});
    assert.equal(c.buildPath('/markets'), '/markets/');
    assert.equal(c.buildPath('/markets/'), '/markets/');
  });
  it('429 handling', async()=>{
    let calls=0;
    const mockFetch = async()=>{
      calls++;
      return { status:429, ok:false, headers:{get:(n)=> n==='Retry-After'?'0':null}, text: async()=> JSON.stringify({code:'RATE_LIMITED'}) };
    };
    const c=createLiveClient({baseUrl:'https://x.example/api/v1', apiKey:'k', fetchImpl: mockFetch});
    try{ await c.listMarkets(); assert.fail('should throw'); }catch(e){ assert.equal(e.code,'RATE_LIMITED'); }
    assert.equal(calls,1);
  });
  it('mode downgrade without key', ()=>{
    const env=loadEnv({PANTA_MODE:'hybrid'});
    assert.equal(env.effectiveMode,'sim');
    assert.ok(env.warnings[0].includes('PANTA_API_KEY'));
  });
  it('priceCache single-flight', async()=>{
    const { createPriceCache } = await import('../src/services/priceCache.js');
    const cache=createPriceCache({ttlMs:1000});
    let calls=0;
    const fetcher=async()=>{ calls++; await new Promise(r=>setTimeout(r,20)); return { v:1 }; };
    const p1=cache.get(fetcher);
    const p2=cache.get(fetcher);
    const [a,b]=await Promise.all([p1,p2]);
    assert.equal(calls,1);
    assert.deepEqual(a,b);
  });
});
