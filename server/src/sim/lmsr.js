export const round6 = (n) => Math.round(n * 1e6) / 1e6;

export function cost(qy, qn, b) {
  const m = Math.max(qy, qn) / b;
  return b * (m + Math.log(Math.exp(qy / b - m) + Math.exp(qn / b - m)));
}
export const priceYes = (qy, qn, b) => 1 / (1 + Math.exp(-(qy - qn) / b));
export const priceNo = (qy, qn, b) => 1 - priceYes(qy, qn, b);

/** Shares received when spending `net` (already fee-adjusted) on `side`. */
export function sharesForSpend(qy, qn, side, net, b) {
  if (net <= 0) return 0;
  const target = cost(qy, qn, b) + net;
  const qSame = side === 'yes' ? qy : qn;
  const qOther = side === 'yes' ? qn : qy;
  const m = target / b;
  const inner = 1 - Math.exp(qOther / b - m);
  if (inner <= 0 || !isFinite(inner)) return 0;
  return round6(b * (m + Math.log(inner)) - qSame);
}
