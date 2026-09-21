import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('claims', ()=>{
  async function setup(){
    const ctx=await makeApp();
    async function auth(W){ let {json}=await ctx.fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})}); const sig=sign(W.kp, json.message); let v=await ctx.fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})}); return {token:v.json.token, kp:W.kp, pub:W.pub}; }
    const A=genWallet(), B=genWallet();
    const UA=await auth(A), UB=await auth(B);
    let r=await ctx.fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Claim Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await ctx.fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Claim market test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await ctx.fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await ctx.fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;
    // B buys YES
    r=await ctx.fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:10}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await ctx.fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    await ctx.fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    return {ctx, UA, UB, marketId, roomId};
  }
  it('claim win happy', async()=>{
    const {ctx, UA, UB, marketId}=await setup();
    await ctx.fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sig=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'1'});
    let r=await ctx.fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status,200);
    await ctx.close();
  });
  it('double claim NOT_CLAIMABLE', async()=>{
    const {ctx, UA, UB, marketId}=await setup();
    await ctx.fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sig=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'a'});
    await ctx.fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sig2=signObj(UB.kp, {kind:'claim_win', marketId, wallet:UB.pub, nonce:'b'});
    let r=await ctx.fetchJson('/api/claims/win',{method:'POST', body:JSON.stringify({marketId, signature:sig2}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.json.error.code,'NOT_CLAIMABLE');
    await ctx.close();
  });
  it('creator fee not graduated fails', async()=>{
    const {ctx, UA, marketId}=await setup();
    await ctx.fetchJson(`/api/markets/${marketId}/resolve`,{method:'POST', body:JSON.stringify({outcome:'yes', force:true}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sig=signObj(UA.kp, {kind:'claim_creator_fees', marketId, wallet:UA.pub, nonce:'fee'});
    let r=await ctx.fetchJson('/api/claims/creator-fees',{method:'POST', body:JSON.stringify({marketId, signature:sig}), headers:{Authorization:`Bearer ${UA.token}`}});
    assert.equal(r.json.error.code,'MARKET_NOT_GRADUATED');
    await ctx.close();
  });
});
