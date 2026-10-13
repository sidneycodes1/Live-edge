import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { usePanelModal } from '../hooks/usePanelModal.jsx';
import { useBalance } from '../hooks/useBalance.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../lib/api.js';
import { fmtUSD } from '../lib/format.js';
import { EMBEDDED_SIGNING_VERIFIED } from '../lib/privy.js';
import {
  TABS,
  CASHOUT_STATES,
  switchTab,
  selectViewMode,
  transitionCashout,
  formatPnl,
  formatCountdown,
  outcomeBadge,
} from '../lib/predictions.js';
import PositionRow from './PositionRow.jsx';
import OddsBar from './OddsBar.jsx';

// ---------------------------------------------------------------------------
// Your Predictions — the overlay formerly named "Portfolio" (owner decision,
// Oct 2026): clicking the rail entry opens the SAME box as before (PanelOverlay
// keeps its size and e2e ids) but the body is now a two-tab experience:
//   Live Predictions — every open bet, ticking with the real market price.
//     0 = honest empty; 1 = straight to detail; 2+ = scrollable summary cards
//     that expand into a full detail view (market + position + Cash Out) with a
//     Back button. Claimable resolved bets stay here — they are not final until
//     claimed (signing-gate honesty unchanged, see lib/privy.js).
//   History — settled/cashed outcomes (GET /api/portfolio/history), WON/LOST/
//     CASHED badges only, newest first, Load-more paging, empty when no activity.
// Honesty: every number is server math (routes/portfolio.js) — the 5s poll only
// re-reads REAL prices; nothing here is animated into looking alive.
// ---------------------------------------------------------------------------

export default function YourPredictions() {
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  const { openCreator, closePanel } = usePanelModal();
  const { showToast } = useToast();
  // Single source of truth for balance + positions (T2): BalanceContext.
  const { data, loading, refresh } = useBalance();

  const [tab, setTab] = useState(TABS.LIVE);
  const [selectedMarketId, setSelectedMarketId] = useState(null);
  const [cash, setCash] = useState({ state: CASHOUT_STATES.IDLE, error: null, proceeds: null });
  const [faucetMsg, setFaucetMsg] = useState('');

  // s8 in-play value: while this overlay is mounted, re-poll the wallet every 5s
  // (paused in hidden tabs) so a running bet's value, P/L and the Cash Out
  // number visibly track the live market price. PanelOverlay unmounts us on
  // close, so the interval dies with the overlay — no background burn.
  useEffect(() => {
    if (!user) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') Promise.resolve(refresh()).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [user, refresh]);

  // Leaving the detail view or switching tabs resets the cash-out machine so
  // reopening never shows a stale confirm strip.
  useEffect(() => {
    if (tab !== TABS.LIVE) setSelectedMarketId(null);
  }, [tab]);
  useEffect(() => {
    setCash({ state: CASHOUT_STATES.IDLE, error: null, proceeds: null });
  }, [selectedMarketId]);

  // Claims stay signing-gated (Amendment 2) — never a fake "Claimed!" toast.
  const signingReady = EMBEDDED_SIGNING_VERIFIED;

  async function faucet() {
    try {
      const r = await api.faucet();
      await refresh();
      setFaucetMsg('Topped up to $' + r.balance);
      showToast(`Faucet: +$100 added — balance $${Number(r.balance).toFixed(2)} (play money)`);
    } catch (e) {
      setFaucetMsg(e.message);
      showToast(`Faucet failed: ${e.message}`);
    }
  }

  const positions = data?.positions || [];
  const openPositions = positions.filter((p) => p.market.status === 'open');
  const claimable = positions.filter((p) => p.market.status === 'resolved');
  // "1 = straight to detail": with a single open bet there is nothing to pick
  // from, so detail opens on it directly. Pressing Back in that mode stores a
  // sentinel so the one-card list is honored instead of detail re-opening and
  // trapping the user.
  const SINGLE_LIST_SENTINEL = '__list';
  const forcedList = selectedMarketId === SINGLE_LIST_SENTINEL;
  const selected = forcedList
    ? null
    : selectedMarketId
      ? openPositions.find((p) => String(p.market.id) === String(selectedMarketId))
      : openPositions.length === 1
        ? openPositions[0]
        : null;
  const viewMode = selectViewMode({
    count: openPositions.length,
    selectedMarketId: selected ? String(selected.market.id) : forcedList ? SINGLE_LIST_SENTINEL : null,
  });

  async function runCashout(marketId) {
    setCash({ state: CASHOUT_STATES.SUBMITTING, error: null, proceeds: null });
    try {
      const r = await api.cashout(marketId);
      const next = transitionCashout(CASHOUT_STATES.SUBMITTING, 'RESOLVE', { proceeds: Number(r.proceeds) || 0 });
      showToast(`Cashed out +${fmtUSD(next.proceeds)} (play money)`);
      await refresh();
      setSelectedMarketId(null); // card is gone — return to the list, honest state
      setCash({ state: CASHOUT_STATES.IDLE, error: null, proceeds: null });
    } catch (e) {
      setCash(transitionCashout(CASHOUT_STATES.SUBMITTING, 'FAIL', { error: e.message }));
    }
  }

  if (!user) {
    // Login-or-nothing (Amendment 2): browse-only visitors get the sign-in
    // overlay, no guest path. Browsing public content stays open.
    return (
      <div className="py-6 text-center" data-testid="portfolio-signed-out">
        <h2 id="portfolio-modal-title" className="font-heading font-bold text-xl">Your Predictions</h2>
        <p className="mt-3 mb-4 text-sm text-white/70">Sign in to see your predictions — it&rsquo;s play money only, never real.</p>
        <button onClick={openAuth} className="bg-brand text-brand-ink px-6 py-2 rounded-full font-bold min-h-[44px]">Sign in</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="your-predictions">
      <h2 id="portfolio-modal-title" className="font-heading font-bold text-2xl">Your Predictions</h2>

      {/* Balance strip — same single-source number the header shows. */}
      <div className="bg-surface border border-white/10 rounded-card p-4 flex flex-wrap gap-3 justify-between items-center">
        <span className="text-sm text-white/60">Balance</span>
        <span className="num font-bold text-lg">${data?.balance?.toFixed(2) || '0.00'}</span>
        <button onClick={faucet} className="bg-white/10 border border-white/20 px-3 py-2 rounded-full text-xs shrink-0 min-h-[44px]">Faucet +$100 (1h)</button>
      </div>

      {/* Two-tab nav (state, never routes — the overlay must not change the URL). */}
      <div role="tablist" className="flex rounded-full bg-white/5 border border-white/10 p-1">
        {[
          { key: TABS.LIVE, label: 'Live Predictions', testId: 'yp-tab-live' },
          { key: TABS.HISTORY, label: 'History', testId: 'yp-tab-history' },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            data-testid={t.testId}
            onClick={() => setTab((cur) => switchTab(cur, t.key))}
            className={`flex-1 min-h-[44px] rounded-full text-sm font-bold cursor-pointer transition-colors ${
              tab === t.key ? 'bg-brand text-brand-ink' : 'text-white/60 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === TABS.LIVE && (
        loading && !data ? (
          <div className="py-6 text-white/60" data-testid="yp-loading">Loading…</div>
        ) : viewMode === 'detail' && selected ? (
          <PositionDetail
            pos={selected}
            cash={cash}
            onBack={() => setSelectedMarketId(openPositions.length === 1 ? SINGLE_LIST_SENTINEL : null)}
            onCashoutStart={() => setCash((s) => transitionCashout(s.state, 'START'))}
            onCashoutCancel={() => setCash({ state: CASHOUT_STATES.IDLE, error: null, proceeds: null })}
            onCashoutConfirm={() => runCashout(selected.market.id)}
          />
        ) : (
          <>
            {openPositions.length === 0 ? (
              <div className="bg-surface border border-white/10 rounded-card p-6 text-center" data-testid="yp-empty">
                <p className="text-sm text-white/70">No live predictions yet.</p>
                <p className="text-xs text-white/50 mt-1">Tap any card on the feed to back a live market — real streams, play money.</p>
                <button onClick={closePanel} className="mt-4 bg-brand text-brand-ink px-6 py-2 rounded-full font-bold min-h-[44px]">Browse the feed</button>
              </div>
            ) : (
              <ul className="space-y-2" data-testid="yp-list">
                {openPositions.map((p) => (
                  <li key={p.market.id}>
                    <button
                      onClick={() => setSelectedMarketId(String(p.market.id))}
                      data-testid={`yp-card-${p.market.id}`}
                      className="w-full text-left bg-surface border border-white/10 rounded-card p-4 hover:border-white/25 cursor-pointer min-h-[44px]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium break-words min-w-0">{p.market.question}</p>
                        <span className="shrink-0 text-[11px] text-white/50 num">{formatCountdown(p.market.end_time)}</span>
                      </div>
                      <p className="text-xs text-white/50 mt-1">
                        {(p.yesShares > 0 ? 'YES' : 'NO')
                          + (p.yesShares > 0 && p.noShares > 0 ? ' + ' : '')
                          + (p.noShares > 0 ? 'NO' : '')}
                        {' · Paid '}{fmtUSD(p.invested)}
                        {' · Value '}{fmtUSD(p.currentValue)}
                      </p>
                      <p className="text-sm mt-1 flex items-center justify-between">
                        <span className={`num font-bold ${p.unrealizedPnl > 0 ? 'text-yes' : p.unrealizedPnl < 0 ? 'text-no' : 'text-white/60'}`} data-testid="yp-card-pnl">
                          {formatPnl(p.unrealizedPnl)}
                        </span>
                        <span className="text-xs text-white/40">Tap for detail ›</span>
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {claimable.length > 0 && (
              <>
                <h3 className="font-heading font-bold pt-2">Ready to settle</h3>
                <div className="space-y-2">{claimable.map((p) => <PositionRow key={p.market.id} pos={p} onClaim={signingReady ? undefined : null} />)}</div>
                {!signingReady && claimable.some((p) => p.claimable) && (
                  <p className="text-xs text-white/55" data-testid="claim-signing-disabled-note">Claims open as soon as wallet signing is verified — nothing is lost; winnings stay in your play-money balance until then.</p>
                )}
              </>
            )}

            <h3 className="font-heading font-bold pt-2">Created Markets</h3>
            {(data?.createdMarkets || []).length === 0 ? (
              <p className="text-white/50 text-sm">You haven&rsquo;t created any markets yet. <button onClick={() => openCreator()} className="underline text-white/70 cursor-pointer">Create one</button></p>
            ) : (
              (data.createdMarkets).map((c) => (
                <div key={c.market.id} className="bg-surface border border-white/10 rounded-card p-4 flex justify-between items-center">
                  <div><p className="text-sm">{c.market.question}</p><p className="text-xs text-white/50">Fees ${c.creatorFeesAccrued} {c.reason ? `· ${c.reason}` : ''}</p></div>
                  {c.canClaimFees && !signingReady && <span className="text-[11px] text-white/45">signing not yet available</span>}
                </div>
              ))
            )}
          </>
        )
      )}

      {tab === TABS.HISTORY && <HistoryList user={user} refreshKey={data?.balance} />}

      {faucetMsg && <p className="text-sm text-yes">{faucetMsg}</p>}
    </div>
  );
}

// Expanded single-position view: live market on one side, position + Cash Out
// on the other (two columns ≥md, stacked on phones). The Cash Out bar sticks to
// the bottom of the modal's scroll container so it never hides behind a fold.
function PositionDetail({ pos, cash, onBack, onCashoutStart, onCashoutCancel, onCashoutConfirm }) {
  const m = pos.market;
  const cashable = cash.state === CASHOUT_STATES.IDLE || cash.state === CASHOUT_STATES.ERROR;
  return (
    <div data-testid="yp-detail" className="space-y-4">
      <button onClick={onBack} data-testid="yp-back" className="min-h-[44px] text-sm text-white/70 hover:text-white cursor-pointer bg-white/5 border border-white/10 rounded-full px-4">
        ‹ All predictions
      </button>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Market block — the odds bar re-renders with fresh server prices every 5s. */}
        <div className="bg-surface border border-white/10 rounded-card p-4 space-y-3">
          <p className="text-sm font-medium">{m.question}</p>
          {Number.isFinite(Number(m.yes_price)) && Number(m.yes_price) > 0 && (
            <OddsBar yesPrice={Number(m.yes_price)} noPrice={Number(m.no_price)} />
          )}
          <p className="text-xs text-white/50 num">Ends in {formatCountdown(m.end_time) || '—'}</p>
        </div>

        {/* Position block — every number straight off /api/portfolio. */}
        <div className="bg-surface border border-white/10 rounded-card p-4 space-y-2">
          <p className="text-xs uppercase tracking-wide text-white/45">Your position</p>
          <p className="text-sm">YES {pos.yesShares} · NO {pos.noShares}</p>
          <p className="text-sm text-white/70">Paid <span className="num font-semibold">{fmtUSD(pos.invested)}</span></p>
          <p className="text-sm text-white/70">Current value <span className="num font-semibold" data-testid="yp-live-value">{fmtUSD(pos.currentValue)}</span></p>
          <p className="text-sm">
            Live P/L{' '}
            <span className={`num font-bold ${pos.unrealizedPnl > 0 ? 'text-yes' : pos.unrealizedPnl < 0 ? 'text-no' : 'text-white/60'}`} data-testid="yp-live-pnl" title="Live P/L, tracks the price">
              {formatPnl(pos.unrealizedPnl)}
            </span>
          </p>
        </div>
      </div>

      {/* Cash Out footer (sticky inside the modal scroller — reachable at 375px). */}
      <div className="sticky bottom-0 pt-3 pb-1 bg-gradient-to-t from-surface to-transparent">
        {cash.state === CASHOUT_STATES.CONFIRMING ? (
          <div className="bg-elevated border border-white/15 rounded-card p-3 flex flex-wrap items-center gap-2" data-testid="yp-cashout-confirm">
            <p className="text-xs text-white/70 flex-1 min-w-[140px]">Sell this whole position at the current market price? Proceeds land in your balance instantly (play money).</p>
            <button onClick={onCashoutConfirm} data-testid="yp-cashout-confirm-yes" className="bg-brand text-brand-ink font-bold px-4 py-2 rounded-full min-h-[44px] cursor-pointer">Confirm</button>
            <button onClick={onCashoutCancel} data-testid="yp-cashout-cancel" className="bg-white/10 border border-white/20 px-4 py-2 rounded-full text-sm min-h-[44px] cursor-pointer">Cancel</button>
          </div>
        ) : (
          <button
            onClick={onCashoutStart}
            disabled={!cashable || cash.state === CASHOUT_STATES.SUBMITTING}
            data-testid="yp-cashout"
            className={`w-full min-h-[48px] rounded-full font-bold cursor-pointer ${
              cashable ? 'bg-brand text-brand-ink' : 'bg-white/10 text-white/40 cursor-not-allowed'
            }`}
          >
            {cash.state === CASHOUT_STATES.SUBMITTING
              ? 'Cashing out…'
              : `Cash Out ${fmtUSD(pos.currentValue)}`}
          </button>
        )}
        {cash.state === CASHOUT_STATES.ERROR && (
          <p className="text-xs text-no mt-2" data-testid="yp-cashout-error">{cash.error || 'Cash out failed.'}</p>
        )}
      </div>
    </div>
  );
}

// History tab body — final results only (WON/LOST/CASHED), from
// GET /api/portfolio/history. Empty until there is activity; Load-more pages
// the rest. The ledger (all transactions) sits underneath, exactly the data
// the retired Portfolio page showed before.
function HistoryList({ user, refreshKey }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('idle'); // idle|loading|error|done
  const [msg, setMsg] = useState('');
  const { data: ledger } = useApi(() => (user ? api.getLedger(20) : Promise.resolve({ items: [] })), [user, refreshKey]);

  const load = useCallback(async (nextOffset) => {
    setStatus('loading');
    try {
      const r = await api.getHistory(50, nextOffset);
      setItems((cur) => (nextOffset === 0 ? r.items : [...cur, ...r.items]));
      setTotal(r.total);
      setOffset(nextOffset + r.items.length);
      setStatus('done');
    } catch (e) {
      setMsg(e.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (user) load(0);
  }, [user, load, refreshKey]);

  if (!user) return null;
  return (
    <div className="space-y-3">
      {status === 'loading' && items.length === 0 && <div className="py-4 text-white/60" data-testid="yp-history-loading">Loading…</div>}
      {status === 'error' && <p className="text-sm text-no" data-testid="yp-history-error">{msg || 'Could not load history.'}</p>}
      {status === 'done' && items.length === 0 && (
        <div className="bg-surface border border-white/10 rounded-card p-6 text-center" data-testid="yp-history-empty">
          <p className="text-sm text-white/70">No history yet.</p>
          <p className="text-xs text-white/50 mt-1">Settled and cashed-out predictions will appear here.</p>
        </div>
      )}
      {items.length > 0 && (
        <ul className="space-y-2" data-testid="yp-history-list">
          {items.map((h) => {
            const badge = outcomeBadge(h.outcome);
            return (
              <li key={h.market.id} className="bg-surface border border-white/10 rounded-card p-4 flex items-center justify-between gap-3" data-testid={`yp-history-row-${h.market.id}`}>
                <div className="min-w-0">
                  <p className="text-sm break-words">{h.market.question}</p>
                  <p className="text-xs text-white/50">
                    {h.side.toUpperCase()} · {new Date(h.closedAt).toLocaleString()} · {formatPnl(h.realizedPnl)}
                  </p>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.className}`} data-testid="yp-history-badge">{badge.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && items.length < total && (
        <button onClick={() => load(offset)} data-testid="yp-history-more" className="w-full min-h-[44px] bg-white/10 border border-white/20 rounded-full text-sm cursor-pointer">
          Load more ({total - items.length} older)
        </button>
      )}

      <h3 className="font-heading font-bold pt-2">All transactions</h3>
      {(ledger?.items || []).length === 0 ? (
        <p className="text-white/50 text-sm">No transactions yet</p>
      ) : (
        <div className="bg-surface border border-white/10 rounded-card divide-y divide-white/10">
          {ledger.items.map((it) => (
            <div key={it.id} className="flex justify-between items-center p-3" data-testid="ledger-row">
              <div>
                <p className="text-sm">{it.label}</p>
                <p className="text-xs text-white/50">{new Date(it.createdAt).toLocaleString()}</p>
              </div>
              <span className={`num font-bold text-sm ${it.delta >= 0 ? 'text-yes' : 'text-no'}`}>
                {it.delta >= 0 ? '+' : ''}
                {Number(it.delta).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
