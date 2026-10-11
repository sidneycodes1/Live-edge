import { GeminiError } from '../../gemini/errors.js';

// ---------------------------------------------------------------------------
// LLM failover chain (server/src/services/llm/chain.js).
//
// THE USER'S CORE ASK: the market engine must NEVER go dark because one provider
// is down or over quota. This wraps an ORDERED list of provider clients — by
// default Gemini → Cloudflare → OpenRouter — behind the SAME interface the engine
// already consumes from the Gemini client: isEnabled() + generateJson(prompt, opts).
// The engine needs zero changes; it just gets a more reliable "gemini".
//
// Per generateJson() call, it walks the chain IN ORDER and:
//   * skips a provider that is disabled (no creds) or has spent its daily budget;
//   * tries the first eligible one; on ANY typed failure (429/5xx/timeout/empty/
//     parse) it records the error and FALLS THROUGH to the next provider;
//   * returns the first success and charges that provider's daily budget.
// If every eligible provider fails it throws a single GeminiError('ALL_FAILED') so
// the engine keeps its last good batch and retries (never wipes live markets, never
// fabricates). If NO provider is enabled at all it returns null — DISABLE-SAFE, the
// same inert contract the standalone clients honour.
//
// Budgets are PER PROVIDER (llm_budget table, keyed by provider + UTC day) so one
// exhausted quota can't stop the chain from trying the next. The store is injectable
// for hermetic tests (no DB required).
// ---------------------------------------------------------------------------

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

// Default budget store: DB-backed (durable across restarts) when a db is given,
// else a process-lifetime in-memory map (tests / no-DB dev). Both self-reset by day.
function createBudgetStore({ db, now }) {
  if (!db) {
    const mem = new Map(); // `${provider}|${day}` -> calls
    const key = (p, d) => `${p}|${d}`;
    return {
      async used(provider, day) {
        return mem.get(key(provider, day)) || 0;
      },
      async spend(provider, day) {
        const next = (mem.get(key(provider, day)) || 0) + 1;
        mem.set(key(provider, day), next);
        return next;
      },
    };
  }
  return {
    async used(provider, day) {
      const { rows } = await db.query('select calls from llm_budget where provider=$1 and day=$2', [provider, day]);
      return rows.length ? Number(rows[0].calls) : 0;
    },
    async spend(provider, day) {
      const next = (await this.used(provider, day)) + 1;
      await db.query(
        `insert into llm_budget(provider, day, calls, updated_at) values($1,$2,1,now())
         on conflict (provider, day) do update set calls = llm_budget.calls + 1, updated_at = now()`,
        [provider, day],
      );
      return next;
    },
  };
}

export function createMarketLLM({ providers = [], db, now = () => Date.now(), warn = (msg) => console.warn(msg), budgetStore } = {}) {
  // Normalise the provider list; keep only entries that actually expose generateJson.
  const chain = providers
    .filter((p) => p && p.client && typeof p.client.generateJson === 'function')
    .map((p) => ({ name: p.name || 'anon', client: p.client, budgetPerDay: Number(p.budgetPerDay) || 0 }));

  const budgets = budgetStore || createBudgetStore({ db, now });
  const state = { lastServed: null, lastError: null, totalCalls: 0, byProvider: {} };

  function isEnabled() {
    return chain.some((p) => p.client.isEnabled?.() === true);
  }

  async function generateJson(prompt, opts = {}) {
    if (!isEnabled()) return null; // DISABLE-SAFE: no provider configured.
    const day = utcDay(now());
    const tried = [];
    let lastError = null;

    for (const p of chain) {
      if (p.client.isEnabled?.() !== true) {
        tried.push(`${p.name}:disabled`);
        continue;
      }
      const used = await budgets.used(p.name, day);
      if (p.budgetPerDay > 0 && used >= p.budgetPerDay) {
        tried.push(`${p.name}:budget`);
        continue;
      }
      try {
        const out = await p.client.generateJson(prompt, opts);
        if (out == null) {
          tried.push(`${p.name}:empty`);
          continue; // a client that returns null (races to disabled) → next provider
        }
        await budgets.spend(p.name, day);
        state.lastServed = p.name;
        state.lastError = null;
        state.totalCalls += 1;
        state.byProvider[p.name] = (state.byProvider[p.name] || 0) + 1;
        return out;
      } catch (e) {
        lastError = e;
        tried.push(`${p.name}:${e.code || e.name || 'error'}`);
        warn(`llmChain: ${p.name} failed (${e.code || e.name}) → trying next provider`);
        // keep walking the chain — this is the automatic handoff.
      }
    }

    const detail = tried.join(', ') || 'no eligible provider';
    throw new GeminiError(
      'ALL_FAILED',
      `All LLM providers failed or unavailable (${detail})`,
      { status: lastError?.status, details: lastError?.details },
    );
  }

  function status() {
    return { enabled: isEnabled(), lastServed: state.lastServed, lastError: state.lastError ? String(state.lastError.code || state.lastError) : null, totalCalls: state.totalCalls, byProvider: { ...state.byProvider } };
  }

  return { isEnabled, generateJson, status, _chain: chain };
}
