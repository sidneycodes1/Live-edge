import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('claims',()=>{
  it('portfolio returns balance', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    const sig=sign(W.kp, json.message);
    let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(v.res.status, 200);
    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${v.json.token}`}});
    assert.equal(port.res.status, 200);
    assert.ok(port.json.balance !== undefined);
    await close();
  });

  it('claim win happy path', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Claim Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Claim market test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:10}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});

    await fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});

    const sig=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'1'});
    r=await fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status, 200);

    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.ok(Number(port.json.balance) > 90);
    await close();
  });

  it('double claim NOT_CLAIMABLE', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Double Claim Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Double claim test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:10}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});

    await fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});

    const sig=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'a'});
    await fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sig2=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'b'});
    r=await fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig2}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.json.error.code,'NOT_CLAIMABLE');
    await close();
  });

  it('loser cannot claim', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Loser Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Loser test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'no', amount:10}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});

    await fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});

    const sig=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'x'});
    r=await fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.json.error.code,'NOT_CLAIMABLE');
    await close();
  });

  it('creator fee not graduated fails', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Creator Fee Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Creator fee test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:5}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});

    await fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});

    const sig=signObj(UA.kp, {kind:'claim_creator_fees', marketId, wallet:UA.pub, nonce:'fee'});
    r=await fetchJson('/api/claims/creator-fees',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UA.token}`}});
    assert.equal(r.json.error.code,'MARKET_NOT_GRADUATED');
    await close();
  });

  it('creator fee claim after graduation', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Graduated Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Graduated test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    for(let i=0; i<12; i++){
      r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:10}), headers:{Authorization:`Bearer ${UB.token}`}});
      const oid=r.json.orderId;
      r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
      const sigO=signObj(UB.kp, r.json.signPayload);
      await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    }
    await fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});

    const sig=signObj(UA.kp, {kind:'claim_creator_fees', marketId, wallet:UA.pub, nonce:'fee'});
    r=await fetchJson('/api/claims/creator-fees',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UA.token}`}});
    assert.equal(r.res.status, 200);
    await close();
  });
});
