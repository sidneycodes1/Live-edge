import { PantaError } from './errors.js';

function withTrailingSlash(p) {
  if (p.includes('?')) return p;
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
        const jitter = Math.random() * 0.5;
        await new Promise((r) => setTimeout(r, retryAfter * 1000 * (1 + jitter)));
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
    async listMarkets({ category, limit, cursor } = {}) {
      // The list endpoint BATCHES prices into each row (yesPrice/noPrice/
      // primaryYesPrice...), so ONE read refreshes many markets — the poller must
      // never fan out per-market (read budget is 120 req/60s). `nextCursor` in the
      // response drives pagination; we echo it back on the next call.
      const qs = new URLSearchParams();
      if (category) qs.set('category', category);
      if (limit) qs.set('limit', String(limit));
      if (cursor) qs.set('cursor', String(cursor));
      const suffix = qs.toString() ? `?${qs}` : '';
      return request(`/markets/${suffix}`);
    },
    async getMarket(id) {
      return request(`/markets/${id}/`);
    },
    // Real trade tape for one market (Phase 5's optional Activity tab). READ-ONLY;
    // the poller never depends on it, so an unexpected shape just yields [].
    async marketTrades(id, { limit, cursor } = {}) {
      const qs = new URLSearchParams();
      if (limit) qs.set('limit', String(limit));
      if (cursor) qs.set('cursor', String(cursor));
      const suffix = qs.toString() ? `?${qs}` : '';
      return request(`/markets/${id}/trades/${suffix}`);
    },
    async quoteCreate(input) {
      const body = {
        wallet: input.wallet,
        question: input.question,
        resolutionRule: input.resolutionRule,
        sourcesOfTruth: input.sourcesOfTruth,
        category: input.category,
        startTime: input.startTime,
        endTime: input.endTime,
        resolutionTime: input.resolutionTime,
        imageUrl: input.imageUrl,
        marketType: input.marketType || 'standard',
        title: input.title,
        description: input.description,
        region: input.region || 'Global',
      };
      return request('/markets/create/quote/', { method: 'POST', body });
    },
    async buildCreate(createId, wallet) {
      return request('/markets/create/build/', { method: 'POST', body: { createId, wallet } });
    },
    async quoteBuy({ marketId, side, amountUsdc, wallet, userId }) {
      return request('/primaryorderquote/', { method: 'POST', body: { wallet, marketId, side, amountUsdc, userId } });
    },
    async buildBuy({ quoteId, wallet, userId, maxSlippageBps = 100 }) {
      return request('/primaryorderbuild/', { method: 'POST', body: { quoteId, wallet, userId, maxSlippageBps } });
    },
    async getPositions(wallet) {
      return request(`/positions/?wallet=${wallet}`);
    },
  };
}
