import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers/testApp.js';
import { genWallet, sign, signObj } from './helpers/wallet.js';

describe('ledger', ()=>{
  it('balance updates after buy', async()=>{
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
    
    // Check initial balance
    let port = await fetchJson('/api/portfolio',{headers:{Authorization:`Bearer ${UB.token}`}});
    assert.equal(Number(port.json.balance), 100);
    
    await close();
  });
});
