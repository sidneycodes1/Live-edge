import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign } from './helpers/wallet.js';

describe('validation', ()=>{
  it('chat length limit', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    const sig=sign(W.kp, json.message);
    let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    const token=v.json.token;
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Val Room'}), headers:{Authorization:`Bearer ${token}`}});
    const roomId=r.json.id;
    const long='a'.repeat(300);
    r=await fetchJson('/api/chat',{method:'POST', body:JSON.stringify({roomId, body: long}), headers:{Authorization:`Bearer ${token}`}});
    assert.equal(r.res.status,400);
    await close();
  });
  it('production does not leak stack', async()=>{
    const { fetchJson, close } = await makeApp();
    const r=await fetchJson('/api/rooms/00000000-0000-0000-0000-000000000000');
    assert.equal(r.res.status,404);
    assert.ok(!JSON.stringify(r.json).includes('at '));
    await close();
  });
});
