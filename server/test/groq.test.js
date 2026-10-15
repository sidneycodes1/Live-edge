import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGroqClient, groqEnabled } from '../src/services/llm/groq.js';
import { GeminiError } from '../src/gemini/errors.js';

// Mocked fetch ONLY — no network, no real key. Groq speaks the OpenAI Chat shape, so a
// success body is { choices:[{ message:{ content } }] }. `calls` records each invocation
// so we can assert the retry count and that the secret travels in a header (never the URL).
function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function contentRes(content) {
  return jsonRes({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
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

describe('groq/createGroqClient', () => {
  it('is DISABLE-SAFE: no key → generateJson returns null, NO call, no throw', async () => {
    const { fn, calls } = mockFetch(contentRes({ markets: [] }));
    const c = createGroqClient({ apiKey: undefined, fetchImpl: fn });
    assert.equal(c.isEnabled(), false);
    assert.equal(await c.generateJson('hi', {}), null);
    assert.equal(calls.length, 0, 'must not touch the network without a key');
  });

  it('posts to /chat/completions with Bearer header + json_object + model (key never in URL)', async () => {
    const { fn, calls } = mockFetch(contentRes({ markets: [] }));
    const c = createGroqClient({ apiKey: 'secret-groq-key', model: 'qwen/qwen3.8-27b', fetchImpl: fn });
    await c.generateJson('prompt text', { systemInstruction: 'sys', temperature: 0.6 });
    const { url, opts } = calls[0];
    assert.ok(url.endsWith('/chat/completions'), url);
    assert.ok(!url.includes('secret-groq-key'), 'API key must NEVER appear in the URL');
    assert.equal(opts.headers.authorization, 'Bearer secret-groq-key');
    assert.equal(opts.headers['content-type'], 'application/json');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'qwen/qwen3.8-27b');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].content, 'prompt text');
  });

  it('parses the message content into JSON and counts one successful call', async () => {
    const { fn } = mockFetch(contentRes({ markets: [{ liveItemId: 'kick:1', question: 'Will X?' }] }));
    const c = createGroqClient({ apiKey: 'k', fetchImpl: fn });
    const out = await c.generateJson('p', {});
    assert.equal(out.markets[0].liveItemId, 'kick:1');
    assert.equal(c.getCalls(), 1);
  });

  it('strips ```json fences before parsing (models wrap even in json mode)', async () => {
    const { fn } = mockFetch(contentRes('```json\n{"markets":[{"question":"Y?"}]}\n```'));
    const c = createGroqClient({ apiKey: 'k', fetchImpl: fn });
    const out = await c.generateJson('p', {});
    assert.equal(out.markets[0].question, 'Y?');
  });

  it('retries ONCE on 429 then succeeds (two upstream calls)', async () => {
    const { fn, calls } = mockFetch(jsonRes({ error: 'rate' }, 429), contentRes({ markets: [] }));
    const c = createGroqClient({ apiKey: 'k', fetchImpl: fn, rateLimitRetryDelayMs: 0 });
    const out = await c.generateJson('p', {});
    assert.deepEqual(out, { markets: [] });
    assert.equal(calls.length, 2);
    assert.equal(c.getCalls(), 1, 'only the 2xx counts as a successful call');
  });

  it('does NOT retry a fatal 400 — throws HTTP_ERROR after one call', async () => {
    const { fn, calls } = mockFetch(jsonRes({ error: 'bad' }, 400));
    const c = createGroqClient({ apiKey: 'k', fetchImpl: fn });
    await assert.rejects(() => c.generateJson('p', {}), (e) => e instanceof GeminiError && e.code === 'HTTP_ERROR' && e.status === 400);
    assert.equal(calls.length, 1);
  });

  it('throws EMPTY on no content and PARSE on non-JSON content', async () => {
    await assert.rejects(
      () => createGroqClient({ apiKey: 'k', fetchImpl: mockFetch(jsonRes({ choices: [{ message: { content: '' } }] })).fn }).generateJson('p', {}),
      (e) => e instanceof GeminiError && e.code === 'EMPTY',
    );
    await assert.rejects(
      () => createGroqClient({ apiKey: 'k', fetchImpl: mockFetch(contentRes('this is prose, not json')).fn }).generateJson('p', {}),
      (e) => e instanceof GeminiError && e.code === 'PARSE',
    );
  });

  it('honours an explicit model, else the repo-documented default', () => {
    assert.equal(createGroqClient({ apiKey: 'k', model: 'override-model' }).model, 'override-model');
    const expectedDefault = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    assert.equal(createGroqClient({ apiKey: 'k' }).model, expectedDefault);
  });

  it('groqEnabled() is a pure cred-presence predicate', () => {
    assert.equal(groqEnabled({ GROQ_API_KEY: 'abc' }), true);
    assert.equal(groqEnabled({}), false);
  });
});
