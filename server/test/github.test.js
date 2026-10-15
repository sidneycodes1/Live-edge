import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubModelsClient, githubEnabled } from '../src/services/llm/github.js';
import { GeminiError } from '../src/gemini/errors.js';

// Mocked fetch ONLY — no network, no real PAT. GitHub Models speaks the OpenAI Chat
// shape at models.inference.ai.azure.com, so a success body is
// { choices:[{ message:{ content } }] }. `calls` records each invocation so we can assert
// the retry count and that the PAT travels in a header (never the URL).
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

describe('github/createGitHubModelsClient', () => {
  it('is DISABLE-SAFE: no token → generateJson returns null, NO call, no throw', async () => {
    const { fn, calls } = mockFetch(contentRes({ markets: [] }));
    const c = createGitHubModelsClient({ token: undefined, fetchImpl: fn });
    assert.equal(c.isEnabled(), false);
    assert.equal(await c.generateJson('hi', {}), null);
    assert.equal(calls.length, 0, 'must not touch the network without a token');
  });

  it('posts to /chat/completions with Bearer PAT header + json_object (token never in URL)', async () => {
    const { fn, calls } = mockFetch(contentRes({ markets: [] }));
    const c = createGitHubModelsClient({ token: 'github_pat_secret', model: 'gpt-4o', fetchImpl: fn });
    await c.generateJson('prompt text', { systemInstruction: 'sys', temperature: 0.6 });
    const { url, opts } = calls[0];
    assert.ok(url.endsWith('/chat/completions'), url);
    assert.ok(!url.includes('github_pat_secret'), 'PAT must NEVER appear in the URL');
    assert.equal(opts.headers.authorization, 'Bearer github_pat_secret');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'gpt-4o');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[1].content, 'prompt text');
  });

  it('parses the message content into JSON and counts one successful call', async () => {
    const { fn } = mockFetch(contentRes({ markets: [{ liveItemId: 'kick:1', question: 'Will X?' }] }));
    const c = createGitHubModelsClient({ token: 'k', fetchImpl: fn });
    const out = await c.generateJson('p', {});
    assert.equal(out.markets[0].liveItemId, 'kick:1');
    assert.equal(c.getCalls(), 1);
  });

  it('retries ONCE on 429 then succeeds', async () => {
    const { fn, calls } = mockFetch(jsonRes({ error: 'rate' }, 429), contentRes({ markets: [] }));
    const c = createGitHubModelsClient({ token: 'k', fetchImpl: fn, rateLimitRetryDelayMs: 0 });
    const out = await c.generateJson('p', {});
    assert.deepEqual(out, { markets: [] });
    assert.equal(calls.length, 2);
  });

  it('does NOT retry a fatal 401 (bad token) — throws HTTP_ERROR after one call', async () => {
    const { fn, calls } = mockFetch(jsonRes({ error: 'unauthorized' }, 401));
    const c = createGitHubModelsClient({ token: 'k', fetchImpl: fn });
    await assert.rejects(() => c.generateJson('p', {}), (e) => e instanceof GeminiError && e.code === 'HTTP_ERROR' && e.status === 401);
    assert.equal(calls.length, 1);
  });

  it('throws EMPTY on no content and PARSE on non-JSON content', async () => {
    await assert.rejects(
      () => createGitHubModelsClient({ token: 'k', fetchImpl: mockFetch(jsonRes({ choices: [{ message: { content: '' } }] })).fn }).generateJson('p', {}),
      (e) => e instanceof GeminiError && e.code === 'EMPTY',
    );
    await assert.rejects(
      () => createGitHubModelsClient({ token: 'k', fetchImpl: mockFetch(contentRes('prose, not json')).fn }).generateJson('p', {}),
      (e) => e instanceof GeminiError && e.code === 'PARSE',
    );
  });

  it('honours an explicit model, else the repo-documented default', () => {
    assert.equal(createGitHubModelsClient({ token: 'k', model: 'phi-4' }).model, 'phi-4');
    const expectedDefault = process.env.GITHUB_MODEL || 'gpt-4o';
    assert.equal(createGitHubModelsClient({ token: 'k' }).model, expectedDefault);
  });

  it('githubEnabled() is a pure token-presence predicate', () => {
    assert.equal(githubEnabled({ GITHUB_MODELS_TOKEN: 'abc' }), true);
    assert.equal(githubEnabled({}), false);
  });
});
