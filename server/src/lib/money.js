export const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
export function toNum(v) {
  if (v === null || v === undefined) return 0;
  return Number(v);
}
