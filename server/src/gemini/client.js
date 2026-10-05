import { GeminiError } from './errors.js';

// ---------------------------------------------------------------------------
// Minimal Gemini client (Phase 2, broadcast-aligned market engine).
//
// Only the pieces the engine needs — nothing else:
//   * REST `models/{model}:generateContent` with a JSON-only output contract
//     (`generationConfig.responseMimeType = application/json` + `responseSchema`),
//     so the model is steered to emit machine-readable objects, never prose.
//   * ONE retry on 429 / 5xx (the transient, retryable classes). Every other
//     failure throws a typed GeminiError the caller can branch on by `.code`.
//   * DISABLE-SAFE: when there is no API key the client is inert — generateJson()
//     returns null WITHOUT a network call and WITHOUT throwing, so a consumer
//     (the market engine) simply keeps serving its last good batch. An absent key
//     must never crash boot and must never hit the network (§7 degrade policy).
//
// The API key is a SECRET: it is sent ONLY in the `x-goog-api-key` header (never
// in a URL that would leak into logs), never logged, never echoed, never written
// to a tracked file or fixture. `timeoutMs` bounds every attempt via AbortController.
//
// DEFAULT_MODEL is the flash-class model already documented in this repo
// (server/src/config/env.js → GEMINI_MODEL default). Overridable via env.GEMINI_MODEL.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_TIMEOUT_MS = 20000;

// 429 (rate) and any 5xx (upstream) are transient → worth exactly one retry.
// Everything else (400 bad request, 401/403 auth, 404 model, etc.) is fatal and
// a blind retry would just burn quota, so we throw immediately.
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

// Concatenate every text part of the first candidate. Empty when the model was
// blocked (safety / promptFeedback) or returned no candidates — both surface as a
// GeminiError('EMPTY') at the call site, never as a fabricated value (§4 honesty).
function extractText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

// Convenience predicate so consumers/`app.js` can gate on cred presence WITHOUT
// importing the whole client (mirrors the twitch/football `*Enabled` booleans).
export function geminiEnabled(apiKey = process.env.GEMINI_API_KEY) {
  return Boolean(apiKey);
}

export function createGeminiClient({
  apiKey,
  model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // A 429 means the per-MINUTE window is spent — retrying instantly just hits
  // the same wall and burns the attempt. Wait this long before the single retry.
  // 5xx stays instant (an upstream blip, not a quota window).
  rateLimitRetryDelayMs = 15000,
  setTimeoutImpl = setTimeout,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  warn = (msg) => console.warn(msg),
} = {}) {
  const enabled = Boolean(apiKey);
  // Cheap in-memory tally of SUCCESSFUL upstream calls (each 2xx = 1 call, so a
  // retried 5xx counts twice). The market engine keeps the AUTHORITATIVE per-day
  // budget in the DB; this is a best-effort secondary signal for tests/health.
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
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        throw new GeminiError('RATE_LIMIT', 'Gemini rate limited (429)', { status: 429, details: await safeText(res) });
      }
      if (!res.ok) {
        // isRetryableStatus() decides whether requestWithRetry() tries again; the
        // code itself is uniform so consumers branch on `.status`/`.code` as needed.
        throw new GeminiError('HTTP_ERROR', `Gemini HTTP ${res.status}`, { status: res.status, details: await safeText(res) });
      }
      const json = await res.json();
      calls += 1;
      return json;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (e?.name === 'AbortError') throw new GeminiError('TIMEOUT', `Gemini request timed out after ${timeoutMs}ms`);
      // Transport/parse-of-response error from fetchImpl itself → NETWORK.
      throw new GeminiError('NETWORK', `Gemini transport error: ${e && e.message ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // Runs the request with exactly ONE retry on the retryable classes. Throws a
  // typed GeminiError for everything else (after the single retry, if retried).
  async function requestWithRetry(payload) {
    try {
      return await postOnce(payload);
    } catch (e) {
      const retryable = e instanceof GeminiError && isRetryableStatus(e.status);
      if (!retryable) throw e;
      warn(`gemini: retrying once after ${e.code}${e.status ? ` (${e.status})` : ''}`);
      if (e.status === 429 && rateLimitRetryDelayMs > 0) {
        await new Promise((r) => {
          const t = setTimeoutImpl(r, rateLimitRetryDelayMs);
          if (t && t.unref) t.unref();
        });
      }
      return postOnce(payload);
    }
  }

  // Public: returns the parsed JSON value (object/array), or null when disabled.
  // Throws GeminiError on a real failure so the engine can decide to keep the last
  // batch instead of treating an outage as "no markets".
  async function generateJson(prompt, { schema, systemInstruction, temperature } = {}) {
    if (!enabled) return null; // DISABLE-SAFE: no key → no call, no crash.

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(schema ? { responseSchema: schema } : {}),
        ...(Number.isFinite(temperature) ? { temperature } : {}),
      },
    };
    if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

    const json = await requestWithRetry(payload);
    const text = extractText(json);
    if (!text) {
      const blocked = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
      throw new GeminiError('EMPTY', `Gemini returned no text${blocked ? ` (blocked: ${blocked})` : ''}`, { details: JSON.stringify(json).slice(0, 500) });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new GeminiError('PARSE', 'Gemini response was not valid JSON', { details: text.slice(0, 500) });
    }
  }

  return { isEnabled, generateJson, getCalls, model };
}

export { GeminiError };
