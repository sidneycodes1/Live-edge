import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, geminiEnabled } from '../src/gemini/client.js';
import { GeminiError } from '../src/gemini/errors.js';

// Mocked fetch ONLY — no network, no real key. `calls` records each invocation so we
// can assert the retry count and that the secret travels in a header (never the URL).
function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function candidateRes(value) {
  return jsonRes({ candidates: [{ content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }] });
}

function mockFetch(...responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn, calls };
}

describe('gemini/createGeminiClient', () => {
  it('is DISABLE-SAFE: no key → generateJson returns null, NO call, no throw', async () => {
    const { fn, calls } = mockFetch(jsonRes('x'));
    const c = createGeminiClient({ apiKey: undefined, fetchImpl: fn });
    assert.equal(c.isEnabled(), false);
    assert.equal(await c.generateJson('hi', { schema: { type: 'OBJECT' } }), null);
    assert.equal(calls.length, 0, 'must not touch the network without a key');
  });

  it('posts to models/{model}:generateContent with JSON config + key in a HEADER (not the URL)', async () => {
    const { fn, calls } = mockFetch(candidateRes({ markets: [] }));
    const c = createGeminiClient({ apiKey: 'secret-key-do-not-log', model: 'gemini-test-flash', fetchImpl: fn });
    await c.generateJson('prompt text', { schema: { type: 'OBJECT', properties: {} } });
    const { url, opts } = calls[0];
    assert.ok(url.endsWith('/models/gemini-test-flash:generateContent'), url);
    assert.ok(!url.includes('secret-key-do-not-log'), 'API key must NEVER appear in the URL');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['x-goog-api-key'], 'secret-key-do-not-log');
    assert.equal(opts.headers['content-type'], 'application/json');
    const body = JSON.parse(opts.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
    assert.equal(body.contents[0].parts[0].text, 'prompt text');
  });

  it('parses the candidate text into JSON and counts one successful call', async () => {
    const { fn } = mockFetch(candidateRes({ markets: [{ liveItemId: 'yt-abc', question: 'Will X?' }] }));
    const c = createGeminiClient({ apiKey: 'k', fetchImpl: fn });
    const out = await c.generateJson('p', {});
    assert.equal(out.markets[0].liveItemId, 'yt-abc');
    assert.equal(c.getCalls(), 1);
  });

  it('retries ONCE on 429 then succeeds (two upstream calls)', async () => {
    const { fn, calls } = mockFetch(jsonRes({ error: 'rate' }, 429), candidateRes({ markets: [] }));
    const c = createGeminiClient({ apiKey: 'k', fetchImpl: fn });
    const out = await c.generateJson('p', {});
    assert.deepEqual(out, { markets: [] });
    assert.equal(calls.length, 2);
    assert.equal(c.getCalls(), 1, 'only the 2xx counts as a successful call');
  });

  it('retries ONCE on 5xx then throws GeminiError(HTTP_ERROR) if it fails again', async () => {
    const { fn, calls } = mockFetch(jsonRes({}, 503), jsonRes({}, 503));
    const c = createGeminiClient({ apiKey: 'k', fetchImpl: fn });
    await assert.rejects(() => c.generateJson('p', {}), (e) => e instanceof GeminiError && e.code === 'HTTP_ERROR' && e.status === 503);
    assert.equal(calls.length, 2, 'exactly one retry on 5xx');
  });

  it('does NOT retry a fatal 4xx (bad request) — throws immediately after one call', async () => {
    const { fn, calls } = mockFetch(jsonRes({ error: 'bad' }, 400));
    const c = createGeminiClient({ apiKey: 'k', fetchImpl: fn });
    await assert.rejects(() => c.generateJson('p', {}), (e) => e instanceof GeminiError && e.code === 'HTTP_ERROR' && e.status === 400);
    assert.equal(calls.length, 1, 'a 400 must not be retried');
  });

  it('classifies an abort as TIMEOUT and a transport throw as NETWORK', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await assert.rejects(
      () => createGeminiClient({ apiKey: 'k', fetchImpl: async () => { throw abort; } }).generateJson('p', {}),
      (e) => e instanceof GeminiError && e.code === 'TIMEOUT',
    );
    await assert.rejects(
      () => createGeminiClient({ apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } }).generateJson('p', {}),
      (e) => e instanceof GeminiError && e.code === 'NETWORK',
    );
  });

  it('throws EMPTY when the 2xx carries no candidate text', async () => {
    const { fn } = mockFetch(jsonRes({ candidates: [{ finishReason: 'SAFETY' }] }));
    const c = createGeminiClient({ apiKey: 'k', fetchImpl: fn });
    await assert.rejects(() => c.generateJson('p', {}), (e) => e instanceof GeminiError && e.code === 'EMPTY');
  });

  it('throws PARSE when the candidate text is not valid JSON', async () => {
    const { fn } = mockFetch(candidateRes('this is prose, not json'));
    const c = createGeminiClient({ apiKey: 'k', fetchImpl: fn });
    await assert.rejects(() => c.generateJson('p', {}), (e) => e instanceof GeminiError && e.code === 'PARSE');
  });

  it('honours an explicit model, else the repo-documented flash default', () => {
    assert.equal(createGeminiClient({ apiKey: 'k', model: 'gemini-override' }).model, 'gemini-override');
    const expectedDefault = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    assert.equal(createGeminiClient({ apiKey: 'k' }).model, expectedDefault);
  });

  it('geminiEnabled() is a pure cred-presence predicate', () => {
    assert.equal(geminiEnabled('abc'), true);
    assert.equal(geminiEnabled(''), false);
    // The no-arg call falls back to the ambient env, so control it explicitly to stay
    // hermetic (other suites may have loaded a real GEMINI_API_KEY into process.env).
    const had = Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_API_KEY');
    const prev = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      assert.equal(geminiEnabled(undefined), false, 'no ambient key → disabled');
      process.env.GEMINI_API_KEY = 'ambient-key';
      assert.equal(geminiEnabled(), true, 'ambient key → enabled');
    } finally {
      if (had) process.env.GEMINI_API_KEY = prev;
      else delete process.env.GEMINI_API_KEY;
    }
  });
});
