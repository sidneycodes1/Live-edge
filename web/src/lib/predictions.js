// Pure state helpers and state machine for Your Predictions overlay.
// Follows the repo's pure+injectable convention (unit-testable without jsdom).

export const TABS = {
  LIVE: 'live',
  HISTORY: 'history',
};

export const CASHOUT_STATES = {
  IDLE: 'idle',
  CONFIRMING: 'confirming',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
  ERROR: 'error',
};

/**
 * Validates and switches between tabs.
 */
export function switchTab(currentTab, nextTab) {
  if (nextTab === TABS.LIVE || nextTab === TABS.HISTORY) {
    return nextTab;
  }
  return currentTab;
}

/**
 * Decides view mode for the Live tab based on position count and user selection.
 * - 0 positions: 'empty'
 * - 1 position: 'detail' (automatically selected)
 * - 2+ positions: 'detail' if selectedMarketId is set, otherwise 'list'
 */
export function selectViewMode({ count, selectedMarketId }) {
  if (!count || count <= 0) return 'empty';
  if (count === 1) return 'detail';
  return selectedMarketId ? 'detail' : 'list';
}

/**
 * Cashout state transition machine.
 */
export function transitionCashout(state, action, payload = {}) {
  switch (action) {
    case 'START':
      return { state: CASHOUT_STATES.CONFIRMING, error: null };
    case 'CANCEL':
      return { state: CASHOUT_STATES.IDLE, error: null };
    case 'CONFIRM':
      return { state: CASHOUT_STATES.SUBMITTING, error: null };
    case 'RESOLVE':
      return { state: CASHOUT_STATES.SUCCESS, proceeds: payload.proceeds ?? 0, error: null };
    case 'FAIL':
      return { state: CASHOUT_STATES.ERROR, error: payload.error || 'Cash out failed' };
    case 'RESET':
      return { state: CASHOUT_STATES.IDLE, error: null };
    default:
      return state;
  }
}

/**
 * Format signed P/L string.
 */
export function formatPnl(amount) {
  const n = Number(amount) || 0;
  if (n > 0) return `+$${n.toFixed(2)}`;
  if (n < 0) return `-$${Math.abs(n).toFixed(2)}`;
  return `$0.00`;
}

/**
 * Badge styling and label for history rows.
 * WON: bg-yes text-on-yes
 * LOST: bg-no text-on-no
 * CASHED: bg-warn text-on-warn
 */
export function outcomeBadge(outcome) {
  switch (String(outcome).toLowerCase()) {
    case 'won':
      return { label: 'WON', className: 'bg-yes text-on-yes' };
    case 'lost':
      return { label: 'LOST', className: 'bg-no text-on-no' };
    case 'cashed':
      return { label: 'CASHED', className: 'bg-warn text-on-warn' };
    default:
      return { label: String(outcome || '').toUpperCase(), className: 'bg-surface text-ink-muted' };
  }
}

/**
 * Human countdown to a market's end_time, biggest two units only:
 * "2d 21h", "5h 12m", "8m 30s", "45s". Returns 'Ended' once past, null when
 * the input is missing/unparsable — the caller then shows an honest em dash
 * instead of a fake timer. Pure + injectable `now` for testability.
 */
export function formatCountdown(endTime, now = Date.now()) {
  if (!endTime) return null;
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (ms <= 0) return 'Ended';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
