// Aggregation error taxonomy. Mirrors ../twitch/errors.js TwitchError shape (and
// ../panta/errors.js): thrown ONLY by internal request helpers so tests can assert
// failure paths; the public client methods and the resilience runner catch these
// and degrade. `code` drives the retry classifier and the aggregator's per-source
// `degraded` reporting, so it is part of the contract — keep values stable.
//
// Reserved codes:
//  MISSING_CREDENTIALS  no creds → client returns [] without touching the network
//  NETWORK              transport threw (DNS/reset/etc) — retryable
//  TIMEOUT              provider call exceeded the timeout budget — retryable
//  HTTP_ERROR           non-2xx upstream; `status` carries the code (>=500 retryable)
//  CIRCUIT_OPEN         breaker is open; NOT retried, source reported degraded
//  BULKHEAD_REJECTED    concurrency cap hit (fail-fast); NOT retried
export class ProviderError extends Error {
  constructor(code, message, { status, details } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
