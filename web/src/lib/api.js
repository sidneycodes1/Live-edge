const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function getToken() { return window.sessionStorage.getItem('liveedge_token'); }
export function setToken(t) { if (t) window.sessionStorage.setItem('liveedge_token', t); else window.sessionStorage.removeItem('liveedge_token'); }

async function request(path, { method='GET', body, auth=false, _retry=0 } = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const tok = getToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  }
  // waking server retry with backoff up to ~70s
  let attempt = 0;
  const maxAttempts = 7;
  while (true) {
    try {
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(()=> ({}));
      if (!res.ok) {
        const err = new Error(json.error?.message || `HTTP ${res.status}`);
        err.code = json.error?.code;
        err.status = res.status;
        err.details = json.error?.details;
        throw err;
      }
      return json;
    } catch (e) {
      const isNetwork = e instanceof TypeError || e.status >= 500 || e.status === 0;
      if (isNetwork && attempt < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(1.8, attempt), 15000);
        await new Promise(r=>setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

export const api = {
  getConfig: () => request('/api/config'),
  getHealth: () => request('/health'),
  getReady: () => request('/ready'),
  nonce: (wallet) => request('/api/auth/nonce', { method:'POST', body:{ wallet } }),
  verify: (wallet, signature) => request('/api/auth/verify', { method:'POST', body:{ wallet, signature } }),
  listRooms: () => request('/api/rooms'),
  getRoom: (id) => request(`/api/rooms/${id}`),
  createRoom: (title, videoUrl) => request('/api/rooms', { method:'POST', body:{ title, videoUrl }, auth:true }),
  getMarket: (id) => request(`/api/markets/${id}`),
  getCatalog: () => request('/api/markets/catalog'),
  quoteMarket: (data) => request('/api/markets/quote', { method:'POST', body:data, auth:true }),
  buildMarket: (quoteId) => request('/api/markets/build', { method:'POST', body:{ quoteId }, auth:true }),
  registerMarket: (quoteId, signature) => request('/api/markets/register', { method:'POST', body:{ quoteId, signature }, auth:true }),
  resolveMarket: (id, outcome, force) => request(`/api/markets/${id}/resolve`, { method:'POST', body:{ outcome, force }, auth:true }),
  quoteOrder: (data) => request('/api/orders/quote', { method:'POST', body:data, auth:true }),
  buildOrder: (orderId) => request('/api/orders/build', { method:'POST', body:{ orderId }, auth:true }),
  submitOrder: (orderId, signature) => request('/api/orders/submit', { method:'POST', body:{ orderId, signature }, auth:true }),
  getPortfolio: () => request('/api/portfolio', { auth:true }),
  faucet: () => request('/api/faucet', { method:'POST', auth:true }),
  claimWin: (marketId, signature) => request('/api/claims/win', { method:'POST', body:{ marketId, signature }, auth:true }),
  claimFees: (marketId, signature) => request('/api/claims/creator-fees', { method:'POST', body:{ marketId, signature }, auth:true }),
  buildClaimWin: (marketId) => request('/api/claims/win/build', { method:'POST', body:{ marketId }, auth:true }),
  buildClaimFees: (marketId) => request('/api/claims/creator-fees/build', { method:'POST', body:{ marketId }, auth:true }),
  chat: (roomId, body) => request('/api/chat', { method:'POST', body:{ roomId, body }, auth:true }),
  metrics: () => request('/api/streamer/metrics', { auth:true }),
};
