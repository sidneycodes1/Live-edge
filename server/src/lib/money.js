export const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
export function toNum(v) {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

// --- Integer micro-unit money math (F-009) ---------------------------------
// Money that moves balances is computed in exact integer micro-units (1 unit
// = 1_000_000 micro) so no binary-float residue can leak into a stored amount.
// Values cross back to decimal dollars only at the storage/LMSR boundary via
// fromMicro(); the DB column type is numeric (exact decimal), so a value with
// <=6 dp round-trips without loss. Float is kept only where the model is
// inherently continuous (LMSR cost/price), never for fee/balance arithmetic.
export const MICRO = 1e6;
export const toMicro = (n) => Math.round(Number(n) * MICRO);
export const fromMicro = (m) => m / MICRO;
// Exact bps scaling in micro-units: round(microIn * bps / 10000), half-up,
// using BigInt so the intermediate product never touches float.
export function microBps(microIn, bps) {
  const v = BigInt(microIn) * BigInt(bps);
  const den = 10000n;
  const q = v / den;
  const r = v % den;
  return Number(r * 2n >= den ? q + 1n : q);
}
// Convenience: bps fee of a decimal dollar amount, returned in decimal dollars
// but computed entirely through the integer micro-unit path.
export const bpsFee = (amount, bps) => fromMicro(microBps(toMicro(amount), bps));
