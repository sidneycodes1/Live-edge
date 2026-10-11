import { GeminiError } from '../../gemini/errors.js';
import { toJsonSchema } from './schema.js';

// ---------------------------------------------------------------------------
// Cloudflare Workers AI client — the durable FREE fallback in the LLM chain.
//
// Exposes the EXACT same surface the market engine already depends on from the
// Gemini client (isEnabled() + generateJson(prompt, {schema, systemInstruction,
// temperature})), so it is a drop-in behind the chain with zero engine changes.
//
// REST shape (verified against the Workers AI JSON-Mode docs, 2026-10):
//   POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}
//   Authorization: Bearer {apiToken}
//   body: { messages:[{role:'system'|'user',content}], response_format:{type:'json_schema', json_schema}, temperature }
//   → { success, result } where result.response is the model's JSON string.
//
// The model path keeps its slashes (@cf/.../...) — it is an operator-controlled env
// value, never user input. The token is a SECRET: header-only, never logged/echoed.
// DISABLE-SAFE: no token/account → inert (isEnabled false, generateJson returns null
// WITHOUT a call). ONE retry on 429/5xx; every other failure throws a typed error so
// the chain can fall through to the next provider.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
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

export function cloudflareEnabled(env = process.env) {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
}

export function createCloudflareClient({
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  model = process.env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  rateLimitRetryDelayMs = 15000,
  setTimeoutImpl = setTimeout,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  warn = (msg) => console.warn(msg),
} = {}) {
  const enabled = Boolean(apiToken && accountId);
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
    const url = `${baseUrl}/accounts/${accountId}/ai/run/${model}`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        throw new GeminiError('RATE_LIMIT', 'Cloudflare AI rate limited (429)', { status: 429, details: await safeText(res) });
      }
      if (!res.ok) {
        throw new GeminiError('HTTP_ERROR', `Cloudflare AI HTTP ${res.status}`, { status: res.status, details: await safeText(res) });
      }
      const json = await res.json();
      if (json && json.success === false) {
        // 200 with success:false is Cloudflare's logical-failure shape → not retryable.
        const msg = Array.isArray(json.errors) && json.errors[0] ? json.errors[0].message || json.errors[0] : 'unknown';
        throw new GeminiError('HTTP_ERROR', `Cloudflare AI error: ${msg}`, { status: res.status, details: JSON.stringify(json).slice(0, 500) });
      }
      calls += 1;
      return json;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (e?.name === 'AbortError') throw new GeminiError('TIMEOUT', `Cloudflare AI request timed out after ${timeoutMs}ms`);
      throw new GeminiError('NETWORK', `Cloudflare AI transport error: ${e && e.message ? e.message : String(e)}`);
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
      warn(`cloudflare: retrying once after ${e.code}${e.status ? ` (${e.status})` : ''}`);
      if (e.status === 429 && rateLimitRetryDelayMs > 0) {
        await new Promise((r) => {
          const t = setTimeoutImpl(r, rateLimitRetryDelayMs);
          if (t && t.unref) t.unref();
        });
      }
      return postOnce(payload);
    }
  }

  async function generateJson(prompt, { schema, systemInstruction, temperature } = {}) {
    if (!enabled) return null; // DISABLE-SAFE: no creds → no call, no crash.

    const messages = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    messages.push({ role: 'user', content: prompt });
    const payload = {
      messages,
      ...(schema ? { response_format: { type: 'json_schema', json_schema: toJsonSchema(schema) } } : {}),
      ...(Number.isFinite(temperature) ? { temperature } : {}),
    };

    const json = await requestWithRetry(payload);
    const raw = json?.result?.response;
    if (raw == null || raw === '') {
      throw new GeminiError('EMPTY', 'Cloudflare AI returned no response', { details: JSON.stringify(json).slice(0, 500) });
    }
    if (typeof raw === 'object') return raw; // some models hand back an object directly
    try {
      return JSON.parse(raw);
    } catch {
      throw new GeminiError('PARSE', 'Cloudflare AI response was not valid JSON', { details: String(raw).slice(0, 500) });
    }
  }

  return { isEnabled, generateJson, getCalls, model };
}
