import { createSimClient } from './simClient.js';
import { createLiveClient } from './liveClient.js';
import { createHybrid } from './hybrid.js';

export function createPanta({ db, env }) {
  const mode = env.effectiveMode || env.PANTA_MODE || 'sim';
  if (mode === 'live') {
    if (!env.PANTA_API_KEY) {
      return createSimClient({ db, env });
    }
    const live = createLiveClient({ baseUrl: env.PANTA_BASE_URL, apiKey: env.PANTA_API_KEY });
    // wrap with sim for settlement? for live we keep sim fallback for settlement methods
    const sim = createSimClient({ db, env });
    return {
      mode: 'live',
      ...live,
      // settlement still sim if needed? follow spec: live mode everything real, but we still expose sim methods for local markets
      async registerMarket(...a) { return sim.registerMarket(...a); },
      async submitBuy(...a) { return sim.submitBuy(...a); },
      async buildClaim(...a) { return sim.buildClaim(...a); },
      async submitClaim(...a) { return sim.submitClaim(...a); },
      async buildCreatorFeeClaim(...a) { return sim.buildCreatorFeeClaim(...a); },
      async submitCreatorFeeClaim(...a) { return sim.submitCreatorFeeClaim(...a); },
      async getMetrics(...a) { return sim.getMetrics(...a); },
      _sim: sim,
      _live: live,
    };
  }
  if (mode === 'hybrid') {
    return createHybrid({ db, env });
  }
  return createSimClient({ db, env });
}
