import { useState } from 'react';
import { api } from '../lib/api.js';
import { getOrCreateGuestWallet, signObject } from '../lib/wallet.js';
import TxStatus from './TxStatus.jsx';

export default function TradeSheet({ market, side: initialSide, onClose, onSuccess }) {
  const [side, setSide] = useState(initialSide);
  const [amount, setAmount] = useState(5);
  const [status, setStatus] = useState('idle'); // idle, quoting, building, submitting, success, error
  const [error, setError] = useState('');
  const [quote, setQuote] = useState(null);

  async function handleBuy() {
    setError('');
    try {
      setStatus('quoting');
      let q = await api.quoteOrder({ marketId: market.id, side, amount });
      setQuote(q);
      setStatus('building');
      let build;
      try {
        build = await api.buildOrder(q.orderId);
      } catch (e) {
        if (e.code==='QUOTE_STALE') {
          // auto retry once
          q = await api.quoteOrder({ marketId: market.id, side, amount });
          build = await api.buildOrder(q.orderId);
        } else throw e;
      }
      setStatus('submitting');
      const gw = getOrCreateGuestWallet();
      const sig = signObject(gw.secretKey, build.signPayload);
      await api.submitOrder(build.orderId || q.orderId, sig);
      setStatus('success');
      setTimeout(()=>{ onSuccess?.(); onClose(); }, 800);
    } catch (e) {
      setError(e.message || 'Failed');
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="bg-surface w-full md:max-w-md rounded-t-card md:rounded-card border border-white/10 p-6">
        <div className="flex justify-between">
          <h3 className="font-heading font-bold">Back {side.toUpperCase()}</h3>
          <button onClick={onClose} className="text-white/60">✕</button>
        </div>
        <p className="text-sm text-white/70 mt-1">{market.question}</p>
        <div className="flex gap-2 mt-4">
          <button onClick={()=>setSide('yes')} className={`flex-1 py-2 rounded-full font-bold ${side==='yes'?'bg-yes text-black':'bg-white/10'}`}>YES</button>
          <button onClick={()=>setSide('no')} className={`flex-1 py-2 rounded-full font-bold ${side==='no'?'bg-no text-white':'bg-white/10'}`}>NO</button>
        </div>
        <div className="flex gap-2 mt-4">
          {[1,5,10].map(v=> <button key={v} onClick={()=>setAmount(v)} className={`px-4 py-2 rounded-full ${amount===v?'bg-white text-black':'bg-white/10'}`}>${v}</button>)}
          <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} className="ml-auto w-20 bg-black/30 border border-white/10 rounded px-2 py-1" />
        </div>
        {quote && <p className="text-xs text-white/60 mt-3">Shares ~{quote.shares} · Fee ${quote.fee} · If {side.toUpperCase()} wins you get about ${quote.payoutIfWin}</p>}
        {!quote && <p className="text-xs text-white/60 mt-3">If {side.toUpperCase()} wins you get about ${amount}</p>}
        <TxStatus status={status} />
        {error && <p className="text-sm text-no mt-2">{error}</p>}
        <button onClick={handleBuy} disabled={status==='quoting'||status==='building'||status==='submitting'} className="w-full mt-4 bg-white text-black font-bold py-3 rounded-full disabled:opacity-50">Confirm ${amount}</button>
      </div>
    </div>
  );
}
