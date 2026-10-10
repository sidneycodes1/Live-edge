import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { usePanelModal } from '../hooks/usePanelModal.jsx';
import { useBalance } from '../hooks/useBalance.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../lib/api.js';
import { EMBEDDED_SIGNING_VERIFIED } from '../lib/privy.js';
import PositionRow from '../components/PositionRow.jsx';
import { useEffect, useState } from 'react';

// Portfolio as an OVERLAY body (owner decision, Oct 2026): rendered inside
// <PanelOverlay/>'s <Modal>, so it no longer owns a full-screen page shell — the
// modal supplies width, padding, scroll and the ✕. Balance is the header number
// (single source via BalanceContext); positions + created markets + the ledger
// all read the same truth. Expired (closed) markets are already filtered out
// server-side, so an old bet simply disappears from the active lists.
export default function Portfolio() {
  const { user } = useAuth();
  const { openAuth, } = useAuthModal();
  const { openCreator } = usePanelModal();
  const { showToast } = useToast();
  // Single source of truth (T2): header and this panel both read BalanceContext.
  const { data, loading, refresh } = useBalance();
  // Transaction history (F-006). Re-fetches whenever the balance changes, so it
  // always lines up with the header/portfolio number above.
  const { data: ledger } = useApi(() => (user ? api.getLedger(20) : Promise.resolve({ items: [] })), [user, data?.balance]);
  const [msg, setMsg] = useState('');

  // s8 in-play value: while the portfolio overlay is open, re-poll the wallet so a
  // running bet's mark-to-market value and P/L visibly track the live market price
  // (the "evolving price" the owner asked for). Pauses when the tab is hidden and
  // stops entirely when this overlay unmounts — it never burns requests in a
  // background tab, and it only re-reads REAL prices (nothing is simulated here).
  useEffect(() => {
    if (!user) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') Promise.resolve(refresh()).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [user, refresh]);

  // Amendment 2 launch gate: claims are wallet-SIGNED actions, and until the
  // Phase-0 spike flips EMBEDDED_SIGNING_VERIFIED there is no signing path for
  // Privy accounts. Claims render an honest disabled state — never a signature
  // attempt that would 401, and never a fake "Claimed!" toast.
  const signingReady = EMBEDDED_SIGNING_VERIFIED;

  async function faucet() {
    try {
      const r = await api.faucet();
      await refresh();
      setMsg('Topped up to $' + r.balance);
      showToast(`Faucet: +$100 added — balance $${Number(r.balance).toFixed(2)} (play money)`);
    } catch (e) { setMsg(e.message); showToast(`Faucet failed: ${e.message}`); }
  }

  if (!user) {
    // Login-or-nothing (Amendment 2): browse-only visitors get the sign-in
    // overlay, no guest path. Browsing public content stays open.
    return (
      <div className="py-6 text-center" data-testid="portfolio-signed-out">
        <h2 id="portfolio-modal-title" className="font-heading font-bold text-xl">Portfolio</h2>
        <p className="mt-3 mb-4 text-sm text-white/70">Sign in to see your portfolio — it&rsquo;s play money only, never real.</p>
        <button onClick={openAuth} className="bg-white text-black px-6 py-2 rounded-full font-bold min-h-[44px]">Sign in</button>
      </div>
    );
  }
  if (loading) return <div className="py-6 text-white/60" data-testid="portfolio-loading">Loading…</div>;

  return (
    <div className="space-y-4" data-testid="portfolio-modal-body">
      <h2 id="portfolio-modal-title" className="font-heading font-bold text-2xl">Portfolio</h2>
      <div className="bg-surface border border-white/10 rounded-card p-4 flex flex-wrap gap-3 justify-between items-center">
        <span className="text-sm text-white/60">Balance</span><span className="num font-bold text-lg">${data?.balance?.toFixed(2) || '0.00'}</span>
        <button onClick={faucet} className="bg-white/10 border border-white/20 px-3 py-2 rounded-full text-xs shrink-0">Faucet +$100 (1h)</button>
      </div>
      {user.kind === 'guest' && (
        <div className="bg-surface border border-white/10 rounded-card p-4">
          <h3 className="font-heading font-bold text-sm mb-1">Legacy guest account</h3>
          <p className="text-xs text-white/50">Guest sign-in was removed — this old browser account can no longer be signed into from the app. Sign in with Privy to start (or continue) a real account with play money.</p>
        </div>
      )}
      <h3 className="font-heading font-bold">Positions</h3>
      {(data?.positions || []).length === 0 ? <p className="text-white/50 text-sm">No open positions yet</p> : data.positions.map(p => <PositionRow key={p.market.id} pos={p} onClaim={signingReady ? undefined : null} />)}
      {!signingReady && (data?.positions || []).some(p => p.claimable) && (
        <p className="text-xs text-white/55" data-testid="claim-signing-disabled-note">Claims open as soon as wallet signing is verified — nothing is lost; winnings stay in your play-money balance until then.</p>
      )}
      <h3 className="font-heading font-bold mt-6">Created Markets</h3>
      {(data?.createdMarkets || []).length === 0
        ? <p className="text-white/50 text-sm">You haven&rsquo;t created any markets yet. <button onClick={() => openCreator()} className="underline text-white/70 cursor-pointer">Create one</button></p>
        : (data?.createdMarkets || []).map(c => (
          <div key={c.market.id} className="bg-surface border border-white/10 rounded-card p-4 flex justify-between items-center">
            <div><p className="text-sm">{c.market.question}</p><p className="text-xs text-white/50">Fees ${c.creatorFeesAccrued} {c.reason ? `· ${c.reason}` : ''}</p></div>
            {c.canClaimFees && !signingReady && <span className="text-[11px] text-white/45">signing not yet available</span>}
          </div>
        ))}
      <h3 className="font-heading font-bold mt-6">Transaction history</h3>
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
      {msg && <p className="text-sm text-yes">{msg}</p>}
    </div>
  );
}
