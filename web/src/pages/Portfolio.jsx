import { useAuth } from '../hooks/useAuth.js';
import { useBalance } from '../hooks/useBalance.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../lib/api.js';
import { EMBEDDED_SIGNING_VERIFIED } from '../lib/privy.js';
import PositionRow from '../components/PositionRow.jsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Portfolio() {
  const { user, loginWithPrivy, privyAvailable } = useAuth();
  const { showToast } = useToast();
  // Single source of truth (T2): header and this page both read BalanceContext.
  const { data, loading, refresh } = useBalance();
  // Transaction history (F-006). Re-fetches whenever the balance changes, so it
  // always lines up with the header/portfolio number above.
  const { data: ledger } = useApi(() => (user ? api.getLedger(20) : Promise.resolve({ items: [] })), [user, data?.balance]);
  const [msg, setMsg] = useState('');

  // Amendment 2 launch gate: claims are wallet-SIGNED actions, and until the
  // Phase-0 spike flips EMBEDDED_SIGNING_VERIFIED there is no signing path for
  // Privy accounts (the guest keypair is retired as an identity). Claims render
  // an honest disabled state — never a signature attempt that would 401, and
  // never a fake "Claimed!" toast.
  const signingReady = EMBEDDED_SIGNING_VERIFIED;

  async function faucet() {
    try {
      const r = await api.faucet();
      await refresh();
      setMsg('Topped up to $'+r.balance);
      showToast(`Faucet: +$100 added — balance $${Number(r.balance).toFixed(2)} (play money)`);
    } catch (e) { setMsg(e.message); showToast(`Faucet failed: ${e.message}`); }
  }

  if (!user) {
    // Login-or-nothing (Amendment 2): browse-only visitors get the Privy modal,
    // no guest path. Browsing public content stays open.
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center" data-testid="portfolio-signed-out">
        <p className="mb-4">Sign in to see your portfolio — it&rsquo;s play money only, never real.</p>
        {privyAvailable ? (
          <button onClick={loginWithPrivy} className="bg-white text-black px-6 py-2 rounded-full font-bold min-h-[44px]">Sign in</button>
        ) : (
          <Link to="/signin" className="bg-white text-black px-6 py-2 rounded-full font-bold">Sign in</Link>
        )}
      </div>
    );
  }
  if (loading) return <div className="max-w-3xl mx-auto px-4 py-6">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 space-y-4">
      <h1 className="font-heading font-bold text-2xl">Portfolio</h1>
      <div className="bg-surface border border-white/10 rounded-card p-4 flex flex-wrap gap-3 justify-between items-center">
        <span className="text-sm text-white/60">Balance</span><span className="num font-bold text-lg">${data?.balance?.toFixed(2) || '0.00'}</span>
        <button onClick={faucet} className="bg-white/10 border border-white/20 px-3 py-2 rounded-full text-xs shrink-0">Faucet +$100 (1h)</button>
      </div>
      {user.kind === 'guest' && (
        <div className="bg-surface border border-white/10 rounded-card p-4">
          <h2 className="font-heading font-bold text-sm mb-1">Legacy guest account</h2>
          <p className="text-xs text-white/50">Guest sign-in was removed — this old browser account can no longer be signed into from the app. Sign in with Privy to start (or continue) a real account with $100 in play money.</p>
        </div>
      )}
      <h2 className="font-heading font-bold">Positions</h2>
      {(data?.positions||[]).length===0 ? <p className="text-white/50 text-sm">No positions yet</p> : data.positions.map(p=> <PositionRow key={p.market.id} pos={p} onClaim={signingReady ? undefined : null} />)}
      {!signingReady && (data?.positions||[]).some(p=>p.claimable) && (
        <p className="text-xs text-white/55" data-testid="claim-signing-disabled-note">Claims open as soon as wallet signing is verified — nothing is lost; winnings stay in your play-money balance until then.</p>
      )}
      <h2 className="font-heading font-bold mt-6">Created Markets</h2>
      {(data?.createdMarkets||[]).map(c=> (
        <div key={c.market.id} className="bg-surface border border-white/10 rounded-card p-4 flex justify-between items-center">
          <div><p className="text-sm">{c.market.question}</p><p className="text-xs text-white/50">Fees ${c.creatorFeesAccrued} {c.reason?`· ${c.reason}`:''}</p></div>
          {c.canClaimFees && !signingReady && <span className="text-[11px] text-white/45">signing not yet available</span>}
        </div>
      ))}
      <h2 className="font-heading font-bold mt-6">Transaction history</h2>
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
