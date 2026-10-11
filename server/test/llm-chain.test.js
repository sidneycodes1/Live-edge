import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketLLM } from '../src/services/llm/chain.js';
import { GeminiError } from '../src/gemini/errors.js';

// Hermetic fake provider: exposes the exact surface the engine/chain relies on
// (isEnabled + generateJson). Behaviour is scripted per call so we can drive the
// fallthrough without any network or DB.
function fakeProvider({ name, enabled = true, results }) {
  // `results` is an array consumed per generateJson() call: an object → return it;
  // a GeminiError/Error → throw it; `null` → return null (disabled-race shape).
  const queue = [...(results || [])];
  const seen = [];
  return {
    name,
    calls: 0,
    seen,
    client: {
      isEnabled: () => enabled,
      async generateJson(prompt, opts) {
        seen.push({ prompt, opts });
        const next = queue.length ? queue.shift() : { fallback: name };
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

describe('llm failover chain', () => {
  it('returns from the FIRST enabled provider when it succeeds (order respected)', async () => {
    const a = fakeProvider({ name: 'gemini', results: [{ markets: [{ liveItemId: 'x' }] }] });
    const b = fakeProvider({ name: 'cloudflare', results: [{ markets: [] }] });
    const chain = createMarketLLM({ providers: [a, b].map((p) => ({ name: p.name, client: p.client, budgetPerDay: 100 })) });

    const out = await chain.generateJson('P', {});
    assert.deepEqual(out, { markets: [{ liveItemId: 'x' }] });
    assert.equal(a.seen.length, 1, 'primary was asked');
    assert.equal(b.seen.length, 0, 'fallback NOT asked when primary succeeds');
    assert.equal(chain.status().lastServed, 'gemini');
  });

  it('falls through to the next provider when the first throws a typed error', async () => {
    const a = fakeProvider({ name: 'gemini', results: [new GeminiError('HTTP_ERROR', 'down', { status: 503 })] });
    const b = fakeProvider({ name: 'cloudflare', results: [{ markets: [{ liveItemId: 'cf' }] }] });
    const chain = createMarketLLM({ providers: [a, b].map((p) => ({ name: p.name, client: p.client, budgetPerDay: 100 })) });

    const out = await chain.generateJson('P', {});
    assert.deepEqual(out, { markets: [{ liveItemId: 'cf' }] });
    assert.equal(a.seen.length, 1);
    assert.equal(b.seen.length, 1, 'fallback engaged after primary failure');
    assert.equal(chain.status().lastServed, 'cloudflare');
  });

  it('skips a disabled provider (no creds) without calling it', async () => {
    const a = fakeProvider({ name: 'gemini', enabled: false, results: [{ markets: [] }] });
    const b = fakeProvider({ name: 'cloudflare', results: [{ markets: [{ liveItemId: 'cf' }] }] });
    const chain = createMarketLLM({ providers: [a, b].map((p) => ({ name: p.name, client: p.client, budgetPerDay: 100 })) });

    const out = await chain.generateJson('P', {});
    assert.deepEqual(out, { markets: [{ liveItemId: 'cf' }] });
    assert.equal(a.seen.length, 0, 'disabled provider is never asked');
  });

  it('skips a provider that has spent its daily budget and uses the next', async () => {
    const a = fakeProvider({ name: 'gemini', results: [{ markets: [{ n: 1 }] }, { markets: [{ n: 2 }] }] });
    const b = fakeProvider({ name: 'cloudflare', results: [{ markets: [{ c: 1 }] }] });
    const chain = createMarketLLM({
      providers: [
        { name: 'gemini', client: a.client, budgetPerDay: 1 }, // one call/day
        { name: 'cloudflare', client: b.client, budgetPerDay: 100 },
      ],
    });

    const first = await chain.generateJson('P', {});
    assert.deepEqual(first, { markets: [{ n: 1 }] });
    assert.equal(chain.status().lastServed, 'gemini');

    // Gemini budget now spent → second call must fall to Cloudflare, never ask Gemini.
    const second = await chain.generateJson('P', {});
    assert.deepEqual(second, { markets: [{ c: 1 }] });
    assert.equal(a.seen.length, 1, 'gemini asked only once (budget cap)');
    assert.equal(b.seen.length, 1, 'cloudflare picked up the overflow');
    assert.equal(chain.status().lastServed, 'cloudflare');
  });

  it('throws a single ALL_FAILED GeminiError when every eligible provider fails', async () => {
    const a = fakeProvider({ name: 'gemini', results: [new GeminiError('TIMEOUT', 'slow')] });
    const b = fakeProvider({ name: 'cloudflare', results: [new GeminiError('HTTP_ERROR', '500', { status: 500 })] });
    const chain = createMarketLLM({ providers: [a, b].map((p) => ({ name: p.name, client: p.client, budgetPerDay: 100 })) });

    await assert.rejects(() => chain.generateJson('P', {}), (e) => e instanceof GeminiError && e.code === 'ALL_FAILED');
  });

  it('is DISABLE-SAFE: returns null (no throw) when nothing is enabled', async () => {
    const a = fakeProvider({ name: 'gemini', enabled: false });
    const b = fakeProvider({ name: 'cloudflare', enabled: false });
    const chain = createMarketLLM({ providers: [a, b].map((p) => ({ name: p.name, client: p.client, budgetPerDay: 100 })) });

    assert.equal(chain.isEnabled(), false);
    const out = await chain.generateJson('P', {});
    assert.equal(out, null, 'no provider → null, matching the standalone clients');
  });

  it('treats a null return from a client as fallthrough to the next provider', async () => {
    const a = fakeProvider({ name: 'gemini', results: [null] });
    const b = fakeProvider({ name: 'cloudflare', results: [{ markets: [{ c: 1 }] }] });
    const chain = createMarketLLM({ providers: [a, b].map((p) => ({ name: p.name, client: p.client, budgetPerDay: 100 })) });

    const out = await chain.generateJson('P', {});
    assert.deepEqual(out, { markets: [{ c: 1 }] });
    assert.equal(chain.status().lastServed, 'cloudflare');
  });
});
