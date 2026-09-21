import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('orders', ()=>{
  it('quote -> build -> submit happy path', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){ let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})}); const sig=sign(W.kp, json.message); let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})}); return {token:v.json.token, kp:W.kp, pub:W.pub}; }
    const A=genWallet(), B=genWallet();
    const UA=await auth(A), UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Orders Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Order test market happy path?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;
    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:5}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status,200);
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status,200);
    const sigO=signObj(UB.kp, r.json.signPayload);
    r=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status,200);
    assert.ok(r.json.trade);
    await close();
  });
  it('idempotent submit', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){ let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})}); const sig=sign(W.kp, json.message); let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})}); return {token:v.json.token, kp:W.kp}; }
    const A=genWallet(), B=genWallet();
    const UA=await auth(A), UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Idemp Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Idempotent market test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;
    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'no', amount:2}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    r=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status,200);
    const r2=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r2.res.status,200);
    assert.ok(r2.json.idempotent);
    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(port.json.balance, 98);
    await close();
  });
});
