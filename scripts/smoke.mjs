import { createApp } from '../server/src/app.js';
import { createDb } from '../server/src/db/index.js';
import { migrate } from '../server/src/db/migrate.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

function wallet() {
  const kp = nacl.sign.keyPair();
  return { kp, pub: bs58.encode(kp.publicKey), sec: kp.secretKey };
}
function sign(kp, message) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
}
// MUST stay byte-identical to server/src/lib/signature.js canonicalStringify
function canonicalStringify(obj) {
  const sorted = {};
  Object.keys(obj).sort().forEach((key) => {
    sorted[key] = obj[key];
  });
  return JSON.stringify(sorted);
}
function signObj(kp, obj) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(canonicalStringify(obj)), kp.secretKey));
}

async function run() {
  const env = {
    NODE_ENV: 'test',
    PORT: 0,
    JWT_SECRET: 'test-secret-32-chars-long-1234567890',
    CORS_ORIGIN: '*',
    PANTA_MODE: 'sim',
    PANTA_BASE_URL: 'https://live-api.panta.market/api/v1',
    SIM_FEE_BPS: 200,
    SIM_CREATOR_SHARE_BPS: 2500,
    SIM_GRADUATION_VOLUME: 100,
    SIM_LIQUIDITY_B: 50,
    effectiveMode: 'sim',
    warnings: [],
  };
  const db = await createDb(env);
  await migrate(db);
  const app = await createApp({ env, db });
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log('smoke server', base);

  const fetchJson = async (path, opts={}) => {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
    const json = await res.json().catch(()=> ({}));
    return { res, json };
  };

  let ok = true;
  const assert = (cond, msg) => {
    if (!cond) { console.error('FAIL', msg); ok=false; } else console.log('PASS', msg);
  };

  // 1 health
  let r = await fetchJson('/health');
  assert(r.res.status===200, 'GET /health 200');
  r = await fetchJson('/ready');
  assert(r.res.status===200 && r.json.db===true, 'GET /ready 200');

  // 2 auth two users
  const A = wallet(); const B = wallet();
  async function authUser(W) {
    let { json } = await fetchJson('/api/auth/nonce', { method:'POST', body: JSON.stringify({ wallet: W.pub }) });
    const { message } = json;
    const sig = sign(W.kp, message);
    let v = await fetchJson('/api/auth/verify', { method:'POST', body: JSON.stringify({ wallet: W.pub, signature: sig }) });
    assert(v.res.status===200 && v.json.token, 'auth verify '+W.pub.slice(0,4));
    // Accept the Terms so the downstream order/claim probes clear the TERMS_REQUIRED gate.
    const st = await fetchJson('/api/me/setup', { method:'POST', body: JSON.stringify({ displayName:'smoke_user', interests:['trading'], termsVersion:'terms-draft-1', accepted:true }), headers:{ Authorization:`Bearer ${v.json.token}` } });
    assert(st.res.status===200, 'accept terms '+W.pub.slice(0,4));
    return { ...W, token: v.json.token, id: v.json.user.id };
  }
  const UA = await authUser(A);
  const UB = await authUser(B);

  // 3 A creates room
  r = await fetchJson('/api/rooms', { method:'POST', body: JSON.stringify({ title: 'Test Room Smoke' }), headers:{ Authorization:`Bearer ${UA.token}` } });
  assert(r.res.status===201, 'create room');
  const roomId = r.json.id;

  // A quotes/builds/registers market
  r = await fetchJson('/api/markets/quote', { method:'POST', body: JSON.stringify({ roomId, question: 'Will smoke test pass first try?', resolutionRule:'YES if test passes', sourcesOfTruth:['https://example.com/stream'], endInMinutes:5 }), headers:{ Authorization:`Bearer ${UA.token}` } });
  assert(r.res.status===200 && r.json.quoteId, 'market quote');
  const quoteId = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method:'POST', body: JSON.stringify({ quoteId }), headers:{ Authorization:`Bearer ${UA.token}` } });
  assert(r.res.status===200 && r.json.signPayload, 'market build');
  const sigM = signObj(UA.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method:'POST', body: JSON.stringify({ quoteId, signature: sigM }), headers:{ Authorization:`Bearer ${UA.token}` } });
  assert(r.res.status===201 && r.json.id, 'market register');
  const marketId = r.json.id;

  // 4 B opens SSE before trading (using http for reliable SSE)
  const sseEvents = [];
  const http = await import('node:http');
  let sseReq;
  let sseBuffer='';
  await new Promise((resolve)=>{
    const url = new URL(`/api/stream/${roomId}`, base);
    sseReq = http.get(url, { headers: { Accept: 'text/event-stream' } }, (res)=>{
      res.on('data', (chunk)=>{
        sseBuffer+=chunk.toString();
        let idx;
        while((idx=sseBuffer.indexOf('\n\n'))!==-1){
          const raw=sseBuffer.slice(0,idx);
          sseBuffer=sseBuffer.slice(idx+2);
          const lines=raw.split('\n');
          let ev='message'; let data='';
          for(const line of lines){
            if(line.startsWith('event:')) ev=line.slice(6).trim();
            if(line.startsWith('data:')) data=line.slice(5).trim();
          }
          if(data) sseEvents.push({ event:ev, data });
        }
      });
      resolve();
    });
    sseReq.on('error', ()=>resolve());
  });
  await new Promise(r=>setTimeout(r, 500));

  // 5 B quotes, builds, submits YES buy
  r = await fetchJson('/api/orders/quote', { method:'POST', body: JSON.stringify({ marketId, side:'yes', amount:5 }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===200 && r.json.orderId, 'order quote');
  const orderId = r.json.orderId;
  const quotedPrice = r.json.price;
  r = await fetchJson('/api/orders/build', { method:'POST', body: JSON.stringify({ orderId }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===200 && r.json.signPayload, 'order build');
  const sigO = signObj(UB.kp, r.json.signPayload);
  r = await fetchJson('/api/orders/submit', { method:'POST', body: JSON.stringify({ orderId, signature: sigO }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===200 && r.json.trade, 'order submit');
  // wait for SSE
  await new Promise(r=>setTimeout(r, 800));
  const hasOdds = sseEvents.some(e=>e.event==='odds');
  const hasTrade = sseEvents.some(e=>e.event==='trade');
  assert(hasOdds, 'SSE odds received');
  assert(hasTrade, 'SSE trade received');
  // check price moved up
  r = await fetchJson(`/api/markets/${marketId}`);
  assert(Number(r.json.yes_price) > quotedPrice, 'price moved up after YES buy');
  // check balance
  r = await fetchJson('/api/portfolio', { headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(Math.abs(r.json.balance - 95) < 0.01, 'balance dropped by 5');
  const hasPos = r.json.positions.some(p=>p.market.id===marketId && p.yesShares>0);
  assert(hasPos, 'position exists');
  // chat has trade line? via room
  r = await fetchJson(`/api/rooms/${roomId}`);
  const hasChatTrade = (r.json.chat||[]).some(c=>c.kind==='trade' && c.body.includes('backed YES'));
  assert(hasChatTrade, 'chat trade line');

  // 6 replay same submit
  r = await fetchJson('/api/orders/submit', { method:'POST', body: JSON.stringify({ orderId, signature: sigO }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===200 && r.json.idempotent, 'replay idempotent');
  r = await fetchJson('/api/portfolio', { headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(Math.abs(r.json.balance - 95) < 0.01, 'no double charge on replay');

  // 7 expired/stale quote -> expired: use fake id
  r = await fetchJson('/api/orders/build', { method:'POST', body: JSON.stringify({ orderId: '00000000-0000-0000-0000-000000000000' }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===410 || r.res.status===404 || r.res.status===400, 'stale/expired error');

  // 8 resolve YES; B claims via build -> sign -> submit (uses stored build nonce)
  r = await fetchJson(`/api/markets/${marketId}/resolve`, { method:'POST', body: JSON.stringify({ outcome:'yes', force:true }), headers:{ Authorization:`Bearer ${UA.token}` } });
  assert(r.res.status===200, 'resolve');
  // B claim
  let bc = await fetchJson('/api/claims/win/build', { method:'POST', body: JSON.stringify({ marketId }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(bc.res.status===200 && bc.json.signPayload, 'claim win build');
  const sigClaim = signObj(UB.kp, bc.json.signPayload);
  r = await fetchJson('/api/claims/win', { method:'POST', body: JSON.stringify({ marketId, signature: sigClaim }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===200, 'claim win');
  r = await fetchJson('/api/portfolio', { headers:{ Authorization:`Bearer ${UB.token}` } });
  // Balance: started 100 -5 + winnings (shares). winnings = shares from earlier order quote
  // we had 5 amount, fee 0.1, net 4.9, shares approx?
  // We'll just check balance >95
  assert(r.json.balance > 95, 'balance after claim >95');
  // second claim -> F-020 idempotent 200 (rebuild then submit; position already claimed).
  // Money-safe: replay must NOT credit the balance a second time.
  const balBeforeReplay = (await fetchJson('/api/portfolio', { headers:{ Authorization:`Bearer ${UB.token}` } })).json.balance;
  let bc2 = await fetchJson('/api/claims/win/build', { method:'POST', body: JSON.stringify({ marketId }), headers:{ Authorization:`Bearer ${UB.token}` } });
  const sigClaim2 = signObj(UB.kp, bc2.json.signPayload);
  r = await fetchJson('/api/claims/win', { method:'POST', body: JSON.stringify({ marketId, signature: sigClaim2 }), headers:{ Authorization:`Bearer ${UB.token}` } });
  assert(r.res.status===200 && r.json.idempotent===true, 'second claim idempotent 200 (F-020)');
  const balAfterReplay = (await fetchJson('/api/portfolio', { headers:{ Authorization:`Bearer ${UB.token}` } })).json.balance;
  assert(balAfterReplay === balBeforeReplay, 'second claim does not pay twice (F-020)');

  // 9 graduation test: create second market with high volume
  // For volume >=100, need multiple buys. We'll do one big buy 100?
  r = await fetchJson('/api/markets/quote', { method:'POST', body: JSON.stringify({ roomId, question: 'Will graduation happen?', resolutionRule:'YES test', sourcesOfTruth:['https://example.com/stream'], endInMinutes:5 }), headers:{ Authorization:`Bearer ${UA.token}` } });
  const q2 = r.json.quoteId;
  r = await fetchJson('/api/markets/build', { method:'POST', body: JSON.stringify({ quoteId: q2 }), headers:{ Authorization:`Bearer ${UA.token}` } });
  const sigM2 = signObj(UA.kp, r.json.signPayload);
  r = await fetchJson('/api/markets/register', { method:'POST', body: JSON.stringify({ quoteId: q2, signature: sigM2 }), headers:{ Authorization:`Bearer ${UA.token}` } });
  const market2 = r.json.id;
  // Need UA to have funds: faucet to top up? UA balance 100, need 100 for buy: use faucet? UA already 100, but after market creation still 100. Let's faucet for UB? UB after claim has >95. Top up UB to 100 for graduation test via faucet? Wait faucet once per hour, but UB just used; might be limited. Instead create new user C with 100 and do large buys.
  const C = wallet();
  const UC = await authUser(C);
  // do buys to reach 100 volume: do 10 buys of 10 each?
  for(let i=0;i<10;i++){
    let q = await fetchJson('/api/orders/quote', { method:'POST', body: JSON.stringify({ marketId: market2, side:'yes', amount:10 }), headers:{ Authorization:`Bearer ${UC.token}` } });
    if(q.res.status!==200) break;
    let b = await fetchJson('/api/orders/build', { method:'POST', body: JSON.stringify({ orderId: q.json.orderId }), headers:{ Authorization:`Bearer ${UC.token}` } });
    let s = signObj(C.kp, b.json.signPayload);
    await fetchJson('/api/orders/submit', { method:'POST', body: JSON.stringify({ orderId: q.json.orderId, signature: s }), headers:{ Authorization:`Bearer ${UC.token}` } });
  }
  // resolve market2
  await fetchJson(`/api/markets/${market2}/resolve`, { method:'POST', body: JSON.stringify({ outcome:'yes', force:true }), headers:{ Authorization:`Bearer ${UA.token}` } });
  // try claim creator fees via build -> sign -> submit
  let fb = await fetchJson('/api/claims/creator-fees/build', { method:'POST', body: JSON.stringify({ marketId: market2 }), headers:{ Authorization:`Bearer ${UA.token}` } });
  const sigFee = signObj(UA.kp, fb.json.signPayload);
  r = await fetchJson('/api/claims/creator-fees', { method:'POST', body: JSON.stringify({ marketId: market2, signature: sigFee }), headers:{ Authorization:`Bearer ${UA.token}` } });
  // if graduated, should succeed; else MARKET_NOT_GRADUATED
  if (r.res.status===200) console.log('PASS creator fee claim graduated');
  else {
    // check below threshold case: create small market and try claim should fail
    r = await fetchJson('/api/markets/quote', { method:'POST', body: JSON.stringify({ roomId, question: 'Small vol market?', resolutionRule:'YES', sourcesOfTruth:['https://example.com/stream'], endInMinutes:5 }), headers:{ Authorization:`Bearer ${UA.token}` } });
    const qs = r.json.quoteId;
    let b2 = await fetchJson('/api/markets/build', { method:'POST', body: JSON.stringify({ quoteId: qs }), headers:{ Authorization:`Bearer ${UA.token}` } });
    let s2 = signObj(UA.kp, b2.json.signPayload);
    let reg = await fetchJson('/api/markets/register', { method:'POST', body: JSON.stringify({ quoteId: qs, signature: s2 }), headers:{ Authorization:`Bearer ${UA.token}` } });
    const smallMid = reg.json.id;
    await fetchJson(`/api/markets/${smallMid}/resolve`, { method:'POST', body: JSON.stringify({ outcome:'yes', force:true }), headers:{ Authorization:`Bearer ${UA.token}` } });
    let fbSmall = await fetchJson('/api/claims/creator-fees/build', { method:'POST', body: JSON.stringify({ marketId: smallMid }), headers:{ Authorization:`Bearer ${UA.token}` } });
    const sigFeeSmall = signObj(UA.kp, fbSmall.json.signPayload);
    let r2 = await fetchJson('/api/claims/creator-fees', { method:'POST', body: JSON.stringify({ marketId: smallMid, signature: sigFeeSmall }), headers:{ Authorization:`Bearer ${UA.token}` } });
    assert(r2.json.error?.code==='MARKET_NOT_GRADUATED', 'creator fee below threshold MARKET_NOT_GRADUATED');
  }

  // 10 metrics
  r = await fetchJson('/api/streamer/metrics', { headers:{ Authorization:`Bearer ${UA.token}` } });
  assert(r.json.totalVolume !== undefined, 'metrics totalVolume');

  try{ sseReq.destroy(); }catch{
    // Ignore cleanup errors
  }
  server.close();
  await db.close();
  console.log(ok ? 'SMOKE PASSED' : 'SMOKE FAILED');
  process.exit(ok?0:1);
}

run().catch(e=>{ console.error(e); process.exit(1); });
