import { useAuth } from '../hooks/useAuth.js';
import { useApi } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import PositionRow from '../components/PositionRow.jsx';
import { getOrCreateGuestWallet, signObject } from '../lib/wallet.js';
import { useState } from 'react';

export default function Portfolio() {
  const { user, signIn } = useAuth();
  const { data, loading, setData } = useApi(()=> user ? api.getPortfolio() : Promise.resolve(null), [user]);
  const [msg, setMsg] = useState('');

  async function claim(pos) {
    try {
      const gw = getOrCreateGuestWallet();
      // build payload? directly use signature over claim object
      const payload = { kind:'claim_win', marketId: pos.market.id, wallet: user.wallet, nonce: Date.now().toString() };
      const sig = signObject(gw.secretKey, payload);
      await api.claimWin(pos.market.id, sig);
      setMsg('Claimed!');
      api.getPortfolio().then(setData);
    } catch (e) { setMsg(e.message); }
  }
  async function claimFees(m) {
    try {
      const gw = getOrCreateGuestWallet();
      const payload = { kind:'claim_creator_fees', marketId: m.market.id, wallet: user.wallet, nonce: Date.now().toString() };
      const sig = signObject(gw.secretKey, payload);
      await api.claimFees(m.market.id, sig);
      setMsg('Fees claimed!');
      api.getPortfolio().then(setData);
    } catch (e) { setMsg(e.message); }
  }
  async function faucet() {
    try { const r=await api.faucet(); setMsg('Topped up to $'+r.balance); api.getPortfolio().then(setData);} catch(e){ setMsg(e.message);}
  }

  if (!user) return <div className="max-w-3xl mx-auto px-4 py-10 text-center"><p className="mb-4">Sign in to see portfolio</p><button onClick={signIn} className="bg-white text-black px-6 py-2 rounded-full font-bold">Sign in (Demo wallet)</button></div>;
  if (loading) return <div className="max-w-3xl mx-auto px-4 py-6">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 space-y-4">
      <h1 className="font-heading font-bold text-2xl">Portfolio</h1>
      <div className="bg-surface border border-white/10 rounded-card p-4 flex justify-between items-center">
        <span className="text-sm text-white/60">Balance</span><span className="num font-bold text-lg">${data?.balance?.toFixed(2) || '0.00'}</span>
        <button onClick={faucet} className="bg-white/10 border border-white/20 px-3 py-1 rounded-full text-xs">Faucet +$100 (1h)</button>
      </div>
      <h2 className="font-heading font-bold">Positions</h2>
      {(data?.positions||[]).length===0 ? <p className="text-white/50 text-sm">No positions yet</p> : data.positions.map(p=> <PositionRow key={p.market.id} pos={p} onClaim={claim} />)}
      <h2 className="font-heading font-bold mt-6">Created Markets</h2>
      {(data?.createdMarkets||[]).map(c=> (
        <div key={c.market.id} className="bg-surface border border-white/10 rounded-card p-4 flex justify-between items-center">
          <div><p className="text-sm">{c.market.question}</p><p className="text-xs text-white/50">Fees ${c.creatorFeesAccrued} {c.reason?`· ${c.reason}`:''}</p></div>
          {c.canClaimFees && <button onClick={()=>claimFees(c)} className="bg-yes text-black px-4 py-2 rounded-full text-sm font-bold">Claim fees</button>}
        </div>
      ))}
      {msg && <p className="text-sm text-yes">{msg}</p>}
    </div>
  );
}
