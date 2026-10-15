import { GeminiError } from '../../gemini/errors.js';

// ---------------------------------------------------------------------------
// Groq client — the PRIMARY market LLM in the failover chain (fastest + reliable).
//
// Same contract as the Gemini/Cloudflare/OpenRouter clients (isEnabled() +
// generateJson(...)), so the chain treats every provider uniformly. Groq speaks the
// OpenAI Chat Completions shape on its LPU hardware (sub-2s generations):
//   POST https://api.groq.com/openai/v1/chat/completions
//   Authorization: Bearer {apiKey}
//   body: { model, messages:[{role,content}], response_format, temperature }
//   → { choices:[{ message:{ content } }] } where content is the model's JSON text.
//
// WHY json_object (not json_schema): like OpenRouter, Groq hosts many models with
// varying strict-schema support, and the engine validates every returned object against
// the live snapshot regardless (it drops unknown liveItemIds, clamps questions, and now
// enforces one market per stream), so loose JSON is still safe — we never trust the
// model to obey a schema (§4 honesty). The engine prompt already says "Return JSON only".
//
// DISABLE-SAFE with no key. ONE retry on 429/5xx. Key is a SECRET (header-only).
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'qwen/qwen3.8-27b';
const DEFAULT_TIMEOUT_MS = 20000; // Groq is fast (~1-2s); 20s is generous headroom, well under OpenRouter's

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

export function groqEnabled(env = process.env) {
  return Boolean(env.GROQ_API_KEY);
}

export function createGroqClient({
  apiKey = process.env.GROQ_API_KEY,
  model = process.env.GROQ_MODEL || DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  rateLimitRetryDelayMs = 5000,
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
        throw new GeminiError('RATE_LIMIT', 'Groq rate limited (429)', { status: 429, details: await safeText(res) });
      }
      if (!res.ok) {
        throw new GeminiError('HTTP_ERROR', `Groq HTTP ${res.status}`, { status: res.status, details: await safeText(res) });
      }
      const json = await res.json();
      calls += 1;
      return json;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (e?.name === 'AbortError') throw new GeminiError('TIMEOUT', `Groq request timed out after ${timeoutMs}ms`);
      throw new GeminiError('NETWORK', `Groq transport error: ${e && e.message ? e.message : String(e)}`);
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
      warn(`groq: retrying once after ${e.code}${e.status ? ` (${e.status})` : ''}`);
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
      throw new GeminiError('EMPTY', 'Groq returned no content', { details: JSON.stringify(json).slice(0, 500) });
    }
    if (typeof content === 'object') return content;
    // Models occasionally wrap JSON in ``` fences even in json mode — strip them.
    const unfenced = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(unfenced);
    } catch {
      throw new GeminiError('PARSE', 'Groq response was not valid JSON', { details: String(content).slice(0, 500) });
    }
  }

  return { isEnabled, generateJson, getCalls, model };
}
