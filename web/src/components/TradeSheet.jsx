import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { PLAY_MONEY_LINE } from '../lib/terms.js';
import { useToast } from '../hooks/useToast.js';

// ---------------------------------------------------------------------------
// Bet sheet. Placing a bet is a real quote -> build -> submit round-trip now
// (owner decision, Oct 2026): the sim server takes the authenticated session as
// the bettor's consent, so there is NO client signing step - the old "bet
// signing not yet available" gate is retired (see routes/orders.js +
// panta/simClient.js submitBuy). Prices come from the live LMSR quote; money
// only moves on a successful submit, and every failure is reported honestly.
// ---------------------------------------------------------------------------
export default function TradeSheet({ market, side: initialSide, onClose, onSuccess }) {
  const { showToast } = useToast();
  const [side, setSide] = useState(initialSide);
  const [amount, setAmount] = useState(5);
  const [quote, setQuote] = useState(null); // { orderId, shares, fee, payoutIfWin }
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function refreshQuote(nextSide = side, nextAmount = amount) {
    if (!nextAmount || nextAmount < 1) { setQuote(null); return; }
    setError('');
    try {
      const q = await api.quoteOrder({ marketId: market.id, side: nextSide, amount: nextAmount });
      setQuote(q);
    } catch (e) {
      setQuote(null);
      setError(e?.message || 'Could not get a price right now.');
    }
  }

  // Preview a real price the moment the sheet opens.
  useEffect(() => {
    refreshQuote(initialSide, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseSide(s) { if (s === side) return; setSide(s); refreshQuote(s, amount); }
  function chooseAmount(v) { setAmount(v); refreshQuote(side, v); }

  async function placeBet() {
    if (!quote?.orderId || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await api.buildOrder(quote.orderId);
      const res = await api.submitOrder(quote.orderId);
      showToast(`Backed ${side.toUpperCase()} for $${amount} - play money.`);
      onSuccess?.(res);
      onClose?.();
    } catch (e) {
      // Honest failure: nothing was changed, keep the sheet open to retry.
      setError(e?.message || 'Could not place the bet. Nothing was changed.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="bg-surface w-full md:max-w-md rounded-t-card md:rounded-card border border-white/10 p-6 pb-safe max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-heading font-bold">Back {side.toUpperCase()}</h3>
          <button onClick={onClose} data-icon aria-label="Close" className="w-9 h-9 -mr-2 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer">&#x2715;</button>
        </div>
        <p className="text-sm text-white/70 mt-1">{market.question}</p>
        <div className="flex gap-2 mt-4">
          <button onClick={()=>chooseSide('yes')} className={`flex-1 py-2 rounded-full font-bold ${side==='yes'?'bg-yes text-black':'bg-white/10'}`}>YES</button>
          <button onClick={()=>chooseSide('no')} className={`flex-1 py-2 rounded-full font-bold ${side==='no'?'bg-no text-white':'bg-white/10'}`}>NO</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {[1,5,10].map(v=> <button key={v} onClick={()=>chooseAmount(v)} className={`px-4 py-2 rounded-full ${amount===v?'bg-white text-black':'bg-white/10'}`}>${v}</button>)}
          <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} onBlur={()=>refreshQuote(side, amount)} aria-label="Custom amount" className="ml-auto w-24 bg-black/30 border border-white/10 rounded px-3 py-2 min-h-[44px]" />
        </div>
        {quote && <p className="text-xs text-white/60 mt-3">Shares ~{quote.shares} &middot; Fee ${quote.fee} &middot; If {side.toUpperCase()} wins you get about ${quote.payoutIfWin}</p>}
        {!quote && !error && <p className="text-xs text-white/40 mt-3">Getting a price&hellip;</p>}
        {error && <p className="text-xs text-no mt-3" data-testid="bet-error">{error}</p>}
        <button
          onClick={placeBet}
          disabled={!quote?.orderId || submitting}
          className="w-full mt-4 bg-white text-black font-bold py-3 rounded-full min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="bet-confirm"
        >
          {submitting ? 'Placing bet&hellip;' : `Bet $${amount} on ${side.toUpperCase()}`}
        </button>
        <p className="text-[11px] text-white/40 mt-3">{PLAY_MONEY_LINE}</p>
      </div>
    </div>
  );
}
