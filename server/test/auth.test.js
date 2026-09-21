import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

describe('auth', ()=>{
  it('nonce -> verify works', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let r=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    assert.equal(r.res.status,200);
    const sig=sign(W.kp, r.json.message);
    r=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(r.res.status,200);
    assert.ok(r.json.token);
    await close();
  });
  it('reused nonce fails', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let r=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    const sig=sign(W.kp, r.json.message);
    await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    r=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(r.res.status,401);
    await close();
  });
  it('wrong wallet signature fails', async()=>{
    const { fetchJson, close } = await makeApp();
    const W1=genWallet(); const W2=genWallet();
    let r=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W1.pub})});
    const sig=sign(W2.kp, r.json.message);
    r=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W1.pub, signature:sig})});
    assert.equal(r.res.status,401);
    await close();
  });
  it('protected route without token 401', async()=>{
    const { fetchJson, close } = await makeApp();
    const r=await fetchJson('/api/portfolio');
    assert.equal(r.res.status,401);
    await close();
  });
});
