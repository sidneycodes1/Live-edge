export const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Uniform (π = 0.5) LMSR core — the EXACT historical math, kept isolated so the
// prior-aware exports below can delegate to it byte-for-byte when a market has no
// prior. Every pre-existing caller (no `prior` arg) lands here unchanged.
// ---------------------------------------------------------------------------
function uCost(qy, qn, b) {
  const m = Math.max(qy, qn) / b;
  return b * (m + Math.log(Math.exp(qy / b - m) + Math.exp(qn / b - m)));
}
function uPriceYes(qy, qn, b) {
  return 1 / (1 + Math.exp(-(qy - qn) / b));
}
function uShares(qy, qn, side, net, b) {
  if (net <= 0) return 0;
  const target = uCost(qy, qn, b) + net;
  const qSame = side === 'yes' ? qy : qn;
  const qOther = side === 'yes' ? qn : qy;
  const m = target / b;
  const inner = 1 - Math.exp(qOther / b - m);
  if (inner <= 0 || !isFinite(inner)) return 0;
  return round6(b * (m + Math.log(inner)) - qSame);
}

// A prior π_yes turns the uniform curve into the prior-weighted curve by SHIFTING the
// quantities: C_prior(q) = C_uniform(q + b·ln π) (π_no = 1 - π_yes). That identity means
// we can reuse the numerically-stable uniform code verbatim, and it makes the price at
// q=0 equal π_yes (so a market opens at the model's line, and the shown price matches
// the executable one). Returns null for a uniform/absent prior so those markets hit the
// exact historical math and stay byte-for-byte unchanged. Clamped off the open-interval
// ends so ln(π) stays finite. Binary LMSR's worst-case loss is b·ln(2) for ANY prior,
// so this never mints play money beyond the F-009 virtual-liquidity bound.
function priorShift(b, prior) {
  if (prior == null || prior === 0.5) return null;
  const p = Number(prior);
  if (!Number.isFinite(p)) return null;
  const py = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return [b * Math.log(py), b * Math.log(1 - py)];
}

export function cost(qy, qn, b, prior) {
  const sh = priorShift(b, prior);
  return sh ? uCost(qy + sh[0], qn + sh[1], b) : uCost(qy, qn, b);
}
export function priceYes(qy, qn, b, prior) {
  const sh = priorShift(b, prior);
  return sh ? uPriceYes(qy + sh[0], qn + sh[1], b) : uPriceYes(qy, qn, b);
}
export function priceNo(qy, qn, b, prior) {
  return 1 - priceYes(qy, qn, b, prior);
}

/** Shares received when spending `net` (already fee-adjusted) on `side`. */
export function sharesForSpend(qy, qn, side, net, b, prior) {
  const sh = priorShift(b, prior);
  return sh ? uShares(qy + sh[0], qn + sh[1], side, net, b) : uShares(qy, qn, side, net, b);
}
