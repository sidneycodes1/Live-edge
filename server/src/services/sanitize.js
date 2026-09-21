export function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  // strip control chars, trim, collapse whitespace
  let t = s.replace(/[\x00-\x1F\x7F]/g, '').trim();
  t = t.replace(/\s+/g, ' ');
  return t;
}
