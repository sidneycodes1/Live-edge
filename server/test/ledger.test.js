import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('ledger',()=>{
  it('auth and balance check', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    const sig=sign(W.kp, json.message);
    let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(v.res.status, 200);
    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${v.json.token}`}});
    assert.equal(port.res.status, 200);
    assert.equal(Number(port.json.balance), 100);
    await close();
  });

  it('balance after successful trade', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Trade Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Trade test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:10}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    console.log('signPayload', JSON.stringify(r.json.signPayload));
    console.log('signature', sigO);
    r=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    
    if (r.res.status !== 200) {
      console.log('Submit failed:', r.res.status, r.json);
    }
    assert.equal(r.res.status, 200);

    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.ok(Number(port.json.balance) < 100);
    assert.ok(Number(port.json.balance) > 0);
    await close();
  });
});
