import { PantaError } from './errors.js';

function withTrailingSlash(p) {
  if (!p.endsWith('/')) return p + '/';
  return p;
}

export function createLiveClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const url = `${base}${withTrailingSlash(path)}`;
    const h = { 'Content-Type': 'application/json', ...headers };
    if (apiKey) h['X-Api-Key'] = apiKey;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetchImpl(url, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') || '2');
        // jitter
        const jitter = Math.random() * 0.5;
        await new Promise((r) => setTimeout(r, retryAfter * 1000 * (1 + jitter)));
        // retry once: caller may retry; here we just throw with retryAfter
        throw new PantaError('RATE_LIMITED', 'Rate limited', { status: 429, retryAfter });
      }
      if (!res.ok) {
        const code = json.code || json.error?.code || 'UPSTREAM_UNAVAILABLE';
        const msg = json.message || json.error?.message || `Upstream error ${res.status}`;
        throw new PantaError(code, msg, { status: res.status });
      }
      return json;
    } catch (e) {
      if (e instanceof PantaError) throw e;
      if (e.name === 'AbortError') throw new PantaError('UPSTREAM_UNAVAILABLE', 'Upstream timeout', { status: 502 });
      throw new PantaError('UPSTREAM_UNAVAILABLE', e.message, { status: 502 });
    } finally {
      clearTimeout(t);
    }
  }

  return {
    buildPath: withTrailingSlash,
    async listMarkets({ category, limit } = {}) {
      const qs = new URLSearchParams();
      if (category) qs.set('category', category);
      if (limit) qs.set('limit', String(limit));
      const suffix = qs.toString() ? `?${qs}` : '';
      return request(`/markets${suffix}`);
    },
    async getMarket(id) {
      return request(`/markets/${id}`);
    },
    async quoteCreate(input) {
      return request('/markets/quote', { method: 'POST', body: input });
    },
    async buildCreate(quoteId, wallet) {
      return request('/markets/build', { method: 'POST', body: { quoteId, wallet } });
    },
    async quoteBuy({ marketId, side, amount, wallet }) {
      return request('/orders/quote', { method: 'POST', body: { marketId, side, amount, wallet } });
    },
    async buildBuy(quoteId) {
      return request('/orders/build', { method: 'POST', body: { quoteId } });
    },
    async getPositions(wallet) {
      return request(`/positions/${wallet}`);
    },
  };
}
