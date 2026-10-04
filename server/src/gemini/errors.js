// Gemini error taxonomy. Same shape as ProviderError (../aggregator/errors.js) and
// TwitchError so failure paths are asserted the same way across providers. Thrown
// ONLY by the internal request helpers in ./client.js; consumers (the market engine)
// catch it and degrade. `code` is part of the contract — keep values stable.
//
// Reserved codes:
//  DISABLED    no API key → generateJson returns null WITHOUT a call (never throws)
//  NETWORK     transport threw (DNS/reset/etc) — retryable
//  TIMEOUT     request exceeded the timeout budget (AbortError) — retryable
//  RATE_LIMIT  HTTP 429 — retryable (exactly one retry)
//  HTTP_ERROR  non-2xx upstream; `status` carries the code (429/5xx retryable)
//  EMPTY       2xx but no usable candidate text (safety block / no candidates)
//  PARSE       candidate text was not valid JSON
export class GeminiError extends Error {
  constructor(code, message, { status, details } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
