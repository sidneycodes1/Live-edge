import { GeminiError } from '../../gemini/errors.js';

// ---------------------------------------------------------------------------
// OpenRouter client — the last-resort EMERGENCY provider in the LLM chain.
//
// Same contract as the Gemini/Cloudflare clients (isEnabled() + generateJson(...)),
// so the chain treats all three uniformly. OpenRouter speaks the OpenAI Chat
// Completions shape:
//   POST https://openrouter.ai/api/v1/chat/completions
//   Authorization: Bearer {apiKey}
//   body: { model, messages:[{role,content}], response_format, temperature }
//   → { choices:[{ message:{ content } }] } where content is the model's JSON text.
//
// WHY json_object (not json_schema) here: the free-tier models OpenRouter routes to
// vary in strict-schema support, and this provider is the FINAL fallback — its job is
// to produce *something parseable* when Gemini and Cloudflare are both down. The
// engine validates every returned object against the live snapshot regardless (it
// drops unknown liveItemIds and clamps questions), so loose JSON is still safe — we
// never trust the model to obey a schema (§4 honesty). The engine prompt already
// contains "Return JSON only", which json_object mode requires.
//
// DISABLE-SAFE with no key. ONE retry on 429/5xx. Key is a SECRET (header-only).
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const DEFAULT_TIMEOUT_MS = 25000; // a touch more headroom for the emergency tier

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

export function openrouterEnabled(env = process.env) {
  return Boolean(env.OPENROUTER_API_KEY);
}

export function createOpenRouterClient({
  apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  rateLimitRetryDelayMs = 15000,
  setTimeoutImpl = setTimeout,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  warn = (msg) => console.warn(msg),
} = {}) {
  const enabled = Boolean(apiKey);
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
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        throw new GeminiError('RATE_LIMIT', 'OpenRouter rate limited (429)', { status: 429, details: await safeText(res) });
      }
      if (!res.ok) {
        throw new GeminiError('HTTP_ERROR', `OpenRouter HTTP ${res.status}`, { status: res.status, details: await safeText(res) });
      }
      const json = await res.json();
      calls += 1;
      return json;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (e?.name === 'AbortError') throw new GeminiError('TIMEOUT', `OpenRouter request timed out after ${timeoutMs}ms`);
      throw new GeminiError('NETWORK', `OpenRouter transport error: ${e && e.message ? e.message : String(e)}`);
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
      warn(`openrouter: retrying once after ${e.code}${e.status ? ` (${e.status})` : ''}`);
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
    if (!enabled) return null; // DISABLE-SAFE: no key → no call, no crash.

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
      throw new GeminiError('EMPTY', 'OpenRouter returned no content', { details: JSON.stringify(json).slice(0, 500) });
    }
    if (typeof content === 'object') return content;
    // Models occasionally wrap JSON in ``` fences even in json mode — strip them.
    const unfenced = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(unfenced);
    } catch {
      throw new GeminiError('PARSE', 'OpenRouter response was not valid JSON', { details: String(content).slice(0, 500) });
    }
  }

  return { isEnabled, generateJson, getCalls, model };
}
