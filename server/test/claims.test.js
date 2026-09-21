import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

describe('claims', ()=>{
  it('portfolio returns balance', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    const sig=sign(W.kp, json.message);
    let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(v.res.status,200);
    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${v.json.token}`}});
    assert.equal(port.res.status,200);
    assert.ok(port.json.balance !== undefined);
    await close();
  });
});
