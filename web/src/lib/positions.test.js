import { describe, it, expect } from 'vitest';
import { positionInsight, pnlLabel } from './positions.js';

// s8 in-play value + settle/loss — the LABEL/derivation rules proven WITHOUT a
// DOM. The numbers come straight from /api/portfolio; this only checks that the
// row reads them honestly and never invents a P/L it wasn't given.

const pos = (over = {}) => ({
  market: { id: 'm', question: 'q', status: 'open', outcome: null },
  yesShares: 0, noShares: 0, claimed: false, claimable: false, claimAmount: 0,
  currentValue: 0, invested: 0, unrealizedPnl: null, settlement: null, ...over,
});

describe('positionInsight — open (in-play) bet', () => {
  it('reports the live value and unrealized P/L against the real cost basis', () => {
    const p = pos({
      currentValue: 14.2, invested: 10, unrealizedPnl: 4.2,
    });
    const i = positionInsight(p);
    expect(i.kind).toBe('open');
    expect(i.headline).toBe('In play');
    expect(i.value).toBe(14.2);
    expect(i.pnl).toBe(4.2);
    expect(i.invested).toBe(10);
  });

  it('a running bet that is under water shows the negative P/L it was given', () => {
    const i = positionInsight(pos({ currentValue: 6, invested: 10, unrealizedPnl: -4 }));
    expect(i.kind).toBe('open');
    expect(i.pnl).toBe(-4);
  });
});

describe('positionInsight — settled bet (win / loss)', () => {
  it('a winning resolved bet reports the payout as WON (not the stale price)', () => {
    const p = pos({
      market: { id: 'm', question: 'q', status: 'resolved', outcome: 'yes' },
      yesShares: 20, noShares: 0, invested: 10,
      currentValue: 11, // mid-board LMSR leftover — must NOT be used as the value
      settlement: { outcome: 'yes', won: true, payout: 20, realizedPnl: 10 },
    });
    const i = positionInsight(p);
    expect(i.kind).toBe('won');
    expect(i.headline).toBe('Won YES');
    expect(i.value).toBe(20);
    expect(i.pnl).toBe(10);
  });

  it('a losing resolved bet reports the honest loss (payout $0)', () => {
    const p = pos({
      market: { id: 'm', question: 'q', status: 'resolved', outcome: 'no' },
      yesShares: 20, noShares: 0, invested: 10,
      settlement: { outcome: 'no', won: false, payout: 0, realizedPnl: -10 },
    });
    const i = positionInsight(p);
    expect(i.kind).toBe('lost');
    expect(i.headline).toBe('Lost — settled NO');
    expect(i.value).toBe(0);
    expect(i.pnl).toBe(-10);
  });
});

describe('positionInsight — honest fallbacks (never fabricate)', () => {
  it('resolved WITHOUT a settlement degrades to pending, no P/L shown', () => {
    const i = positionInsight(pos({ market: { id: 'm', status: 'resolved', outcome: null } }));
    expect(i.kind).toBe('pending');
    expect(i.pnl).toBeNull();
    expect(i.headline).toBe('Awaiting resolution');
  });

  it('is total on empty/garbage input (never throws, no invented gain)', () => {
    for (const bad of [undefined, null, {}, { market: null }]) {
      const i = positionInsight(bad);
      expect(['open', 'won', 'lost', 'pending']).toContain(i.kind);
    }
  });
});

describe('pnlLabel — signed money string or nothing', () => {
  it('formats a gain, a loss, and zero with an explicit sign', () => {
    expect(pnlLabel(4.2)).toBe('+$4.20');
    expect(pnlLabel(-3)).toBe('−$3.00');
    expect(pnlLabel(0)).toBe('+$0.00');
  });
  it('returns null for a missing / non-numeric P/L (render nothing honest)', () => {
    expect(pnlLabel(null)).toBeNull();
    expect(pnlLabel(undefined)).toBeNull();
    expect(pnlLabel(NaN)).toBeNull();
  });
});
