import { describe, expect, it } from 'vitest';
import {
  TABS,
  CASHOUT_STATES,
  switchTab,
  selectViewMode,
  transitionCashout,
  formatPnl,
  outcomeBadge,
} from './predictions.js';

describe('predictions helper (pure state logic)', () => {
  it('switches between valid tabs and rejects unknown tabs', () => {
    expect(switchTab(TABS.LIVE, TABS.HISTORY)).toBe(TABS.HISTORY);
    expect(switchTab(TABS.HISTORY, TABS.LIVE)).toBe(TABS.LIVE);
    expect(switchTab(TABS.LIVE, 'invalid')).toBe(TABS.LIVE);
  });

  it('selects view mode based on bet count and selection', () => {
    expect(selectViewMode({ count: 0, selectedMarketId: null })).toBe('empty');
    expect(selectViewMode({ count: 1, selectedMarketId: null })).toBe('detail');
    expect(selectViewMode({ count: 2, selectedMarketId: null })).toBe('list');
    expect(selectViewMode({ count: 2, selectedMarketId: 'm1' })).toBe('detail');
    expect(selectViewMode({ count: 5, selectedMarketId: 'm3' })).toBe('detail');
  });

  it('transitions cashout states correctly through happy path', () => {
    let current = { state: CASHOUT_STATES.IDLE, error: null };

    current = transitionCashout(current, 'START');
    expect(current.state).toBe(CASHOUT_STATES.CONFIRMING);

    current = transitionCashout(current, 'CONFIRM');
    expect(current.state).toBe(CASHOUT_STATES.SUBMITTING);

    current = transitionCashout(current, 'RESOLVE', { proceeds: 12.5 });
    expect(current.state).toBe(CASHOUT_STATES.SUCCESS);
    expect(current.proceeds).toBe(12.5);

    current = transitionCashout(current, 'RESET');
    expect(current.state).toBe(CASHOUT_STATES.IDLE);
  });

  it('handles cashout cancel and failure transitions', () => {
    let current = { state: CASHOUT_STATES.IDLE, error: null };
    current = transitionCashout(current, 'START');
    expect(current.state).toBe(CASHOUT_STATES.CONFIRMING);

    current = transitionCashout(current, 'CANCEL');
    expect(current.state).toBe(CASHOUT_STATES.IDLE);

    current = transitionCashout(current, 'START');
    current = transitionCashout(current, 'CONFIRM');
    current = transitionCashout(current, 'FAIL', { error: 'Price moved' });
    expect(current.state).toBe(CASHOUT_STATES.ERROR);
    expect(current.error).toBe('Price moved');

    current = transitionCashout(current, 'RESET');
    expect(current.state).toBe(CASHOUT_STATES.IDLE);
  });

  it('formats signed P/L string accurately', () => {
    expect(formatPnl(5.25)).toBe('+$5.25');
    expect(formatPnl(-3.5)).toBe('-$3.50');
    expect(formatPnl(0)).toBe('$0.00');
  });

  it('provides correct badge labels and semantic color tokens for history outcomes', () => {
    expect(outcomeBadge('won')).toEqual({ label: 'WON', className: 'bg-yes text-on-yes' });
    expect(outcomeBadge('lost')).toEqual({ label: 'LOST', className: 'bg-no text-on-no' });
    expect(outcomeBadge('cashed')).toEqual({ label: 'CASHED', className: 'bg-warn text-on-warn' });
  });
});
