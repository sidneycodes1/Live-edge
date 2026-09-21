import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('ledger concurrency', ()=>{
  it('parallel buys do not corrupt balances', async()=>{
    const { fetchJson, close } = await makeApp();
    // auth
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    // A creates room and market
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Ledger Test Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Ledger concurrency test market?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    // UB does 5 parallel buys of $5 each (has 100)
    const promises = Array.from({length:5}, async()=>{
      const qq=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:5}), headers:{Authorization:`Bearer ${UB.token}`}});
      const oid=qq.json.orderId;
      const b=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
      const s=signObj(UB.kp, b.json.signPayload);
      return fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:s}), headers:{Authorization:`Bearer ${UB.token}`}});
    });
    const results = await Promise.all(promises);
    // at least some should succeed, none should corrupt balance negative
    let succ=results.filter(x=>x.res.status===200).length;
    assert.ok(succ>=3);
    const port = await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.ok(Number(port.json.balance)>=0);
    assert.ok(Number(port.json.balance) <=100);
    const {json:m}=await fetchJson(`/api/markets/${marketId}`);
    assert.ok(isFinite(Number(m.yes_price)));
    await close();
  });
});
