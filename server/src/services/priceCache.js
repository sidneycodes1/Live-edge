export function createPriceCache({ ttlMs = 10000 } = {}) {
  let cache = null; // { data, expiresAt }
  let inflight = null;

  async function get(fetcher) {
    const now = Date.now();
    if (cache && now < cache.expiresAt) return cache.data;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const data = await fetcher();
        cache = { data, expiresAt: Date.now() + ttlMs };
        return data;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function clear() {
    cache = null;
    inflight = null;
  }

  return { get, clear };
}
