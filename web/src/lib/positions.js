import { fmtUSD } from './format.js';

// ---------------------------------------------------------------------------
// In-play position value + settle/loss (Phase 2, s8) — PURE read of the REAL
// fields /api/portfolio returns (routes/portfolio.js): invested (cost basis),
// currentValue (mark-to-market), unrealizedPnl (open only), settlement
// ({ outcome, won, payout, realizedPnl } for a resolved bet).
//
// Honesty (Panta Door 1): every number here is the server's real math — we only
// FORMAT and LABEL it. A running bet shows its live mark-to-market value and the
// unrealized P/L against what was actually paid; a settled bet shows the real
// payoff (win) or the honest loss (the losing side pays $0). Nothing is inferred
// about a market the server didn't describe — an unknown shape degrades to a
// plain "no P/L to show" state rather than a fabricated gain.
// ---------------------------------------------------------------------------

// Classify one portfolio position into the ONE state the row should present.
// `kind` drives the label/tone; the money fields are always real or null.
export function positionInsight(pos) {
  const market = pos?.market || {};
  const status = market.status;

  // RESOLVED → the settlement the server computed IS the truth of the bet.
  const s = pos?.settlement;
  if (status === 'resolved' && s && (s.outcome === 'yes' || s.outcome === 'no')) {
    const won = Boolean(s.won);
    return {
      kind: won ? 'won' : 'lost',
      status,
      outcome: s.outcome,
      invested: numOrNull(pos.invested),
      // For a settled bet the payoff (win) or $0 (loss) is the real value, not
      // the mid-board LMSR price the sim resolve leaves behind.
      value: numOrNull(s.payout),
      pnl: numOrNull(s.realizedPnl),
      headline: won
        ? `Won ${s.outcome.toUpperCase()}`
        : `Lost — settled ${s.outcome.toUpperCase()}`,
    };
  }

  // OPEN → live in-play value + unrealized P/L, both read straight off the row.
  if (status === 'open') {
    return {
      kind: 'open',
      status,
      outcome: null,
      invested: numOrNull(pos.invested),
      value: numOrNull(pos.currentValue),
      pnl: numOrNull(pos.unrealizedPnl),
      headline: 'In play',
    };
  }

  // Anything else (awaiting resolution / a shape we can't stand behind): show
  // the value we have but NO P/L, and never label a win/loss that isn't real.
  return {
    kind: 'pending',
    status: status || 'unknown',
    outcome: null,
    invested: null,
    value: numOrNull(pos?.currentValue),
    pnl: null,
    headline: 'Awaiting resolution',
  };
}

// A signed, human P/L string ("+$4.20" / "−$3.00" / "+$0.00"), or null when there
// is genuinely nothing to show. The minus is a real hyphen-minus for easy CSS.
export function pnlLabel(pnl) {
  if (pnl == null || !Number.isFinite(pnl)) return null;
  const rounded = Math.round(pnl * 100) / 100;
  const sign = rounded >= 0 ? '+' : '−';
  return `${sign}${fmtUSD(Math.abs(rounded))}`;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
