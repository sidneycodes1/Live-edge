export class PantaError extends Error {
  constructor(code, message, { status = 400, retryAfter, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.details = details;
  }
}

export const ERROR_MAP = {
  QUOTE_STALE: { status: 409, message: 'Price moved — please re-quote' },
  QUOTE_EXPIRED: { status: 410, message: 'Quote expired — please re-quote' },
  AMOUNT_TOO_SMALL: { status: 400, message: 'Amount too small (min 1 USDC)' },
  INSUFFICIENT_FUNDS: { status: 400, message: 'Insufficient balance' },
  DUPLICATE_MARKET: { status: 409, message: 'Market with this question already exists' },
  NOT_CLAIMABLE: { status: 400, message: 'Nothing to claim' },
  MARKET_NOT_GRADUATED: { status: 400, message: 'Creator fees unlock when market graduates (≥100 volume)' },
  MARKET_CLOSED: { status: 400, message: 'Market is closed for trading' },
  RATE_LIMITED: { status: 429, message: 'Too many requests, retry shortly' },
  UPSTREAM_UNAVAILABLE: { status: 502, message: 'Upstream temporarily unavailable' },
  VALIDATION_ERROR: { status: 400, message: 'Invalid input' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Not found' },
};

export function toHttpError(err) {
  if (err instanceof PantaError) return err;
  if (err instanceof Error && err.name === 'ZodError') {
    return new PantaError('VALIDATION_ERROR', ERROR_MAP.VALIDATION_ERROR.message, {
      status: 400,
      details: err.errors ?? err.issues,
    });
  }
  return new PantaError('UPSTREAM_UNAVAILABLE', err.message || 'Unknown error', { status: 500 });
}
