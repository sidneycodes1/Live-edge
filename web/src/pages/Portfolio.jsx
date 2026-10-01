import { useAuth } from '../hooks/useAuth.js';
import { useBalance } from '../hooks/useBalance.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../lib/api.js';
import PositionRow from '../components/PositionRow.jsx';
import { getOrCreateGuestWallet, signMessage } from '../lib/wallet.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Portfolio() {
  const { user, signIn, upgrade } = useAuth();
  const { showToast } = useToast();
  // Single source of truth (T2): header and this page both read BalanceContext.
  const { data, loading, refresh } = useBalance();
  // Transaction history (F-006). Re-fetches whenever the balance changes, so it
  // always lines up with the header/portfolio number above.
  const { data: ledger } = useApi(() => (user ? api.getLedger(20) : Promise.resolve({ items: [] })), [user, data?.balance]);
  const [msg, setMsg] = useState('');
  const [upEmail, setUpEmail] = useState('');
  const [upPw, setUpPw] = useState('');
  const [upMsg, setUpMsg] = useState('');

  async function doUpgrade(e) {
    e.preventDefault();
    setUpMsg('');
    try {
      await upgrade(upEmail, upPw);
      showToast('Account upgraded — you can now log in with email & password');
      setUpEmail(''); setUpPw('');
    } catch (err) { setUpMsg(err.message); }
  }

  async function claim(pos) {
    try {
      const gw = getOrCreateGuestWallet();
      // Server requires the build-time nonce: fetch the canonical payload from
      // /win/build, sign that exact string, then submit (mirrors scripts/e2e-audit.mjs).
      const { canonicalPayload } = await api.buildClaimWin(pos.market.id);
      const sig = signMessage(gw.secretKey, canonicalPayload);
      const r = await api.claimWin(pos.market.id, sig);
      await refresh();
      setMsg('Claimed!');
      showToast(`Claimed! +$${Number(r.amount).toFixed(2)} added to your balance`);
    } catch (e) { setMsg(e.message); showToast(`Claim failed: ${e.message}`); }
  }
  async function claimFees(m) {
    try {
      const gw = getOrCreateGuestWallet();
      const { canonicalPayload } = await api.buildClaimFees(m.market.id);
      const sig = signMessage(gw.secretKey, canonicalPayload);
      const r = await api.claimFees(m.market.id, sig);
      await refresh();
      setMsg('Fees claimed!');
      showToast(`Creator fees claimed: +$${Number(r.amount).toFixed(2)}`);
    } catch (e) { setMsg(e.message); showToast(`Fee claim failed: ${e.message}`); }
  }
  async function faucet() {
    try {
      const r = await api.faucet();
      await refresh();
      setMsg('Topped up to $'+r.balance);
      showToast(`Faucet: +$100 added — balance $${Number(r.balance).toFixed(2)}`);
    } catch (e) { setMsg(e.message); showToast(`Faucet failed: ${e.message}`); }
  }

  if (!user) return <div className="max-w-3xl mx-auto px-4 py-10 text-center"><p className="mb-4">Sign in to see portfolio</p><div className="flex gap-3 justify-center"><Link to="/signin" className="bg-white text-black px-6 py-2 rounded-full font-bold">Create account / Log in</Link><button onClick={signIn} className="border border-white/20 px-6 py-2 rounded-full font-bold">Continue as guest</button></div></div>;
  if (loading) return <div className="max-w-3xl mx-auto px-4 py-6">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 space-y-4">
      <h1 className="font-heading font-bold text-2xl">Portfolio</h1>
      <div className="bg-surface border border-white/10 rounded-card p-4 flex flex-wrap gap-3 justify-between items-center">
        <span className="text-sm text-white/60">Balance</span><span className="num font-bold text-lg">${data?.balance?.toFixed(2) || '0.00'}</span>
        <button onClick={faucet} className="bg-white/10 border border-white/20 px-3 py-2 rounded-full text-xs shrink-0">Faucet +$100 (1h)</button>
      </div>
      {user.kind === 'guest' && (
        <form onSubmit={doUpgrade} className="bg-surface border border-white/10 rounded-card p-4">
          <h2 className="font-heading font-bold text-sm mb-1">Upgrade to a full account</h2>
          <p className="text-xs text-white/50 mb-3">Keep this wallet, balance and positions exactly as they are — just add an email and password so you can log back in later.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="email" required value={upEmail} onChange={(e)=>setUpEmail(e.target.value)} placeholder="Email" className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
            <input type="password" required minLength={8} value={upPw} onChange={(e)=>setUpPw(e.target.value)} placeholder="Password (min 8)" className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
            <button type="submit" className="bg-white text-black px-4 py-2 rounded-full text-sm font-bold">Upgrade</button>
          </div>
          {upMsg && <p className="text-xs text-no mt-2">{upMsg}</p>}
        </form>
      )}
      <h2 className="font-heading font-bold">Positions</h2>
      {(data?.positions||[]).length===0 ? <p className="text-white/50 text-sm">No positions yet</p> : data.positions.map(p=> <PositionRow key={p.market.id} pos={p} onClaim={claim} />)}
      <h2 className="font-heading font-bold mt-6">Created Markets</h2>
      {(data?.createdMarkets||[]).map(c=> (
        <div key={c.market.id} className="bg-surface border border-white/10 rounded-card p-4 flex justify-between items-center">
          <div><p className="text-sm">{c.market.question}</p><p className="text-xs text-white/50">Fees ${c.creatorFeesAccrued} {c.reason?`· ${c.reason}`:''}</p></div>
          {c.canClaimFees && <button onClick={()=>claimFees(c)} className="bg-yes text-black px-4 py-2 rounded-full text-sm font-bold">Claim fees</button>}
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
