export function resolveApiBase({ value, dev }) {
  const base = String(value || '').trim().replace(/\/$/, '');
  if (!base) {
    if (dev) return 'http://localhost:4000';
    throw new Error('LiveEdge is not configured: VITE_API_URL must point to the deployed API.');
  }
  if (!dev && /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(base)) {
    throw new Error('LiveEdge is not configured: production cannot use a localhost API URL.');
  }
  return base;
}
