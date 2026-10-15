import { GeminiError } from '../../gemini/errors.js';

// ---------------------------------------------------------------------------
// GitHub Models client — a LAST-RESORT fallback in the LLM chain.
//
// GitHub Models exposes Azure-hosted models (gpt-4o, Llama 3.3 70B, Mistral, Phi…)
// through an OpenAI-compatible endpoint, authenticated with a GitHub personal access
// token (the SAME contract as the other clients: isEnabled() + generateJson(...)):
//   POST https://models.inference.ai.azure.com/chat/completions
//   Authorization: Bearer {github PAT}
//   body: { model, messages:[{role,content}], response_format, temperature }
//   → { choices:[{ message:{ content } }] }
//
// CAVEATS that keep this provider ordered LAST:
//   - Free (non-Copilot) rate limits are low (~100 req/day) and the inference host is
//     not always DNS-reachable, so it is a genuine emergency rung, not a daily driver.
//   - A repo-scoped PAT is being reused as an LLM credential — an operator should mint
//     a dedicated, minimally-scoped token for this. Secrets stay header-only.
// DISABLE-SAFE with no token. ONE retry on 429/5xx.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://models.inference.ai.azure.com';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 20000;

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export function githubEnabled(env = process.env) {
  return Boolean(env.GITHUB_MODELS_TOKEN);
}

export function createGitHubModelsClient({
  token = process.env.GITHUB_MODELS_TOKEN,
  model = process.env.GITHUB_MODEL || DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  rateLimitRetryDelayMs = 5000,
  setTimeoutImpl = setTimeout,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  warn = (msg) => console.warn(msg),
} = {}) {
  const enabled = Boolean(token);
  let calls = 0;

  function isEnabled() {
    return enabled;
  }
  function getCalls() {
    return calls;
  }

  async function postOnce(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `${baseUrl}/chat/completions`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        throw new GeminiError('RATE_LIMIT', 'GitHub Models rate limited (429)', { status: 429, details: await safeText(res) });
      }
      if (!res.ok) {
        throw new GeminiError('HTTP_ERROR', `GitHub Models HTTP ${res.status}`, { status: res.status, details: await safeText(res) });
      }
      const json = await res.json();
      calls += 1;
      return json;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (e?.name === 'AbortError') throw new GeminiError('TIMEOUT', `GitHub Models request timed out after ${timeoutMs}ms`);
      throw new GeminiError('NETWORK', `GitHub Models transport error: ${e && e.message ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestWithRetry(payload) {
    try {
      return await postOnce(payload);
    } catch (e) {
      const retryable = e instanceof GeminiError && isRetryableStatus(e.status);
      if (!retryable) throw e;
      warn(`github: retrying once after ${e.code}${e.status ? ` (${e.status})` : ''}`);
      if (e.status === 429 && rateLimitRetryDelayMs > 0) {
        await new Promise((r) => {
          const t = setTimeoutImpl(r, rateLimitRetryDelayMs);
          if (t && t.unref) t.unref();
        });
      }
      return postOnce(payload);
    }
  }

  async function generateJson(prompt, { systemInstruction, temperature } = {}) {
    if (!enabled) return null; // DISABLE-SAFE: no token → no call, no crash.

    const messages = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    messages.push({ role: 'user', content: prompt });
    const payload = {
      model,
      messages,
      response_format: { type: 'json_object' },
      ...(Number.isFinite(temperature) ? { temperature } : {}),
    };

    const json = await requestWithRetry(payload);
    const content = json?.choices?.[0]?.message?.content;
    if (content == null || content === '') {
      throw new GeminiError('EMPTY', 'GitHub Models returned no content', { details: JSON.stringify(json).slice(0, 500) });
    }
    if (typeof content === 'object') return content;
    // Strip any ``` fences before parsing (same defensive handling as the other clients).
    const unfenced = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(unfenced);
    } catch {
      throw new GeminiError('PARSE', 'GitHub Models response was not valid JSON', { details: String(content).slice(0, 500) });
    }
  }

  return { isEnabled, generateJson, getCalls, model };
}
