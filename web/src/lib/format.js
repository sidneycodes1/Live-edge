export const fmtPrice = (p) => (p*100).toFixed(1)+'%';
export const fmtUSD = (n) => `$${Number(n).toFixed(2)}`;
// Landing/detail countdown clamp (docs/live-aggregation-spec.md §4 honesty).
// Render NOTHING meaningful ("—") rather than garbage or a negative count when:
//   • the end time is absent or unparseable (null/undefined/''/bad string), or
//   • the market is already past (never count negative), or
//   • it is more than 48h away (a bad seed like "38522164m" is not a countdown).
// Only a genuine sub-48h, future end time yields a live "Nm Ns" countdown.
export const fmtTimeLeft = (end) => {
  if (end == null || end === '') return '—';        // absent end time
  const t = new Date(end).getTime();
  if (!Number.isFinite(t)) return '—';              // unparseable end time
  const diff = t - Date.now();
  if (diff <= 0) return '—';                        // past → never negative
  if (diff > 48 * 60 * 60 * 1000) return '—';       // far future → not a countdown
  const m = Math.floor(diff/60000);
  const s = Math.floor((diff%60000)/1000);
  return `${m}m ${s}s`;
};
