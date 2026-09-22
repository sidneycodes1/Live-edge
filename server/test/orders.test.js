import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('orders',()=>{
  it('auth returns token', async()=>{
    const { fetchJson, close } = await makeApp();
    const W=genWallet();
    let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
    const sig=sign(W.kp, json.message);
    let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
    assert.equal(v.res.status, 200);
    assert.ok(v.json.token);
    await close();
  });

  it('INSUFFICIENT_FUNDS error', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Insufficient Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Insufficient test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:200}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    r=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, 'INSUFFICIENT_FUNDS');

    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(Number(port.json.balance), 100);
    await close();
  });

  it('idempotent submit', async()=>{
    const { fetchJson, close } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Idemp Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Idempotent test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    const qq=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:5}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=qq.json.orderId;
    const b=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const s=signObj(UB.kp, b.json.signPayload);

    r=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:s}), headers:{Authorization:`Bearer ${UB.token}`}});
    if (r.res.status !== 200) {
      console.log('First submit failed:', r.res.status, r.json);
    }
    assert.equal(r.res.status, 200);
    const r2=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:s}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r2.res.status, 200);
    assert.ok(r2.json.idempotent);

    const port=await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(Number(port.json.balance), 95);
    await close();
  });

  it('3 parallel buys on same market', async()=>{
    const { fetchJson, close, db } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet();
    const users = Array.from({length:3}, () => genWallet());
    const UA=await auth(A);
    const UBs = await Promise.all(users.map(auth));
    
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Parallel Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Parallel test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    const m0=await fetchJson(`/api/markets/${marketId}`);
    const initialQYes = Number(m0.json.q_yes);

    const promises = UBs.map(async (user) => {
      const qq=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:5}), headers:{Authorization:`Bearer ${user.token}`}});
      const oid=qq.json.orderId;
      const b=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${user.token}`}});
      const s=signObj(user.kp, b.json.signPayload);
      return fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:s}), headers:{Authorization:`Bearer ${user.token}`}});
    });
    const results = await Promise.all(promises);
    
    const succ = results.filter(x => x.res.status === 200).length;
    assert.ok(succ >= 2, `Expected at least 2 successful parallel buys, got ${succ}`);

    const { rows: mRows } = await db.query('select q_yes from markets where id=$1', [marketId]);
    const finalQYes = Number(mRows[0].q_yes);
    assert.ok(finalQYes > initialQYes, 'q_yes should increase after parallel buys');

    for (const user of UBs) {
      const { rows: bRows } = await db.query('select sim_usdc from balances where user_id=$1', [user.id]);
      const bal = Number(bRows[0]?.sim_usdc || 0);
      assert.ok(bal >= 0, `Balance should not be negative for user ${user.id}, got ${bal}`);
    }
    await close();
  });

  it('concurrent duplicate signature - exactly one trade', async()=>{
    const { fetchJson, close, db } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Concurrent Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Concurrent test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:5}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const s=signObj(UB.kp, r.json.signPayload);

    const promises = [
      fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:s}), headers:{Authorization:`Bearer ${UB.token}`}}),
      fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:s}), headers:{Authorization:`Bearer ${UB.token}`}}),
    ];
    const results = await Promise.all(promises);

    assert.equal(results[0].res.status, 200);
    assert.equal(results[1].res.status, 200);
    const idempotentCount = results.filter(r => r.json.idempotent).length;
    assert.ok(idempotentCount === 1, 'Exactly one should be idempotent');

    const { rows: tRows } = await db.query('select count(*) as c from trades where signature=$1', [s]);
    assert.equal(Number(tRows[0].c), 1, 'Exactly one trade should be recorded');
    await close();
  });

  it('insufficient funds mid-transaction - no partial changes', async()=>{
    const { fetchJson, close, db } = await makeApp();
    async function auth(W){
      let {json}=await fetchJson('/api/auth/nonce',{method:'POST', body:JSON.stringify({wallet:W.pub})});
      const sig=sign(W.kp, json.message);
      let v=await fetchJson('/api/auth/verify',{method:'POST', body:JSON.stringify({wallet:W.pub, signature:sig})});
      return {token:v.json.token, pub:W.pub, kp:W.kp, id:v.json.user.id};
    }
    const A=genWallet(); const B=genWallet();
    const UA=await auth(A); const UB=await auth(B);
    let r=await fetchJson('/api/rooms',{method:'POST', body:JSON.stringify({title:'Rollback Room'}), headers:{Authorization:`Bearer ${UA.token}`}});
    const roomId=r.json.id;
    r=await fetchJson('/api/markets/quote',{method:'POST', body:JSON.stringify({roomId, question:'Rollback test?', resolutionRule:'YES', sourcesOfTruth:['https://x']}), headers:{Authorization:`Bearer ${UA.token}`}});
    const q=r.json.quoteId;
    r=await fetchJson('/api/markets/build',{method:'POST', body:JSON.stringify({quoteId:q}), headers:{Authorization:`Bearer ${UA.token}`}});
    const sigM=signObj(UA.kp, r.json.signPayload);
    r=await fetchJson('/api/markets/register',{method:'POST', body:JSON.stringify({quoteId:q, signature:sigM}), headers:{Authorization:`Bearer ${UA.token}`}});
    const marketId=r.json.id;

    r=await fetchJson('/api/orders/quote',{method:'POST', body:JSON.stringify({marketId, side:'yes', amount:200}), headers:{Authorization:`Bearer ${UB.token}`}});
    const oid=r.json.orderId;
    r=await fetchJson('/api/orders/build',{method:'POST', body:JSON.stringify({orderId:oid}), headers:{Authorization:`Bearer ${UB.token}`}});
    const sigO=signObj(UB.kp, r.json.signPayload);
    r=await fetchJson('/api/orders/submit',{method:'POST', body:JSON.stringify({orderId:oid, signature:sigO}), headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, 'INSUFFICIENT_FUNDS');

    const { rows: pRows } = await db.query('select * from positions where user_id=$1 and market_id=$2', [UB.id, marketId]);
    assert.equal(pRows.length, 0, 'No position should be created after insufficient funds');
    
    const { rows: tRows } = await db.query('select * from trades where user_id=$1 and market_id=$2', [UB.id, marketId]);
    assert.equal(tRows.length, 0, 'No trade should be recorded after insufficient funds');

    const { rows: bRows } = await db.query('select sim_usdc from balances where user_id=$1', [UB.id]);
    assert.equal(Number(bRows[0].sim_usdc), 100, 'Balance should remain 100 after insufficient funds');
    await close();
  });
});
