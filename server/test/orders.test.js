import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

describe('orders', ()=>{
  it('auth flow works', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    assert.ok(json.nonce);
    const sig=sign(W.kp, json.message);
    let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(v.res.status,200);
    assert.ok(v.json.token);
    await close();
  });
});
