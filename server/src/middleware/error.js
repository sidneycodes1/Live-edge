import { PantaError } from '../panta/errors.js';

export function errorHandler(err, req, res, _next) {
  let e = err;
  if (!(e instanceof PantaError)) {
    if (e.name === 'ZodError') {
      e = new PantaError('VALIDATION_ERROR', 'Invalid input', { status: 400, details: e.errors ?? e.issues });
    } else {
      const status = e.status || 500;
      const code = e.code || 'UPSTREAM_UNAVAILABLE';
      e = new PantaError(code, e.message || 'Internal error', { status });
    }
  }
  const status = e.status || 500;
  const body = { error: { code: e.code, message: e.message } };
  if (e.details) body.error.details = e.details;
  if (e.retryAfter) body.error.retryAfter = e.retryAfter;
  // never leak stack in production
  if (process.env.NODE_ENV !== 'production' && e.stack) {
    // optionally log
  }
  res.status(status).json(body);
}
