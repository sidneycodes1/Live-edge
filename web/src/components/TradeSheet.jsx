import { useState } from 'react';
import { api } from '../lib/api.js';
import { EMBEDDED_SIGNING_VERIFIED } from '../lib/privy.js';
import { PLAY_MONEY_LINE } from '../lib/terms.js';
import TxStatus from './TxStatus.jsx';

// ---------------------------------------------------------------------------
// Bet sheet. Amendment 2 LAUNCH GATE: with guest mode removed, every claim/order
// signature must come from the Privy embedded wallet — and the Phase-0 signing
// spike has NOT recorded SIGNING_OK (lib/privy.js EMBEDDED_SIGNING_VERIFIED is
// false, the lead's spike owns the flip). So submission renders an honest
// DISABLED state — never a fake success and never the retired guest-keypair
// signing path. Quoting stays live because it shows REAL market prices.
// ---------------------------------------------------------------------------
export default function TradeSheet({ market, side: initialSide, onClose }) {
  const [side, setSide] = useState(initialSide);
  const [amount, setAmount] = useState(5);
  const [status] = useState('idle'); // idle only while the signing gate is closed
  const [quote, setQuote] = useState(null);
  const signingReady = EMBEDDED_SIGNING_VERIFIED;

  async function refreshQuote() {
    try {
      const q = await api.quoteOrder({ marketId: market.id, side, amount });
      setQuote(q);
    } catch { /* honest: keep the last quote (or none); errors are not faked away */ }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="bg-surface w-full md:max-w-md rounded-t-card md:rounded-card border border-white/10 p-6 pb-safe max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-heading font-bold">Back {side.toUpperCase()}</h3>
          <button onClick={onClose} data-icon aria-label="Close" className="w-9 h-9 -mr-2 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer">✕</button>
        </div>
        <p className="text-sm text-white/70 mt-1">{market.question}</p>
        <div className="flex gap-2 mt-4">
          <button onClick={()=>setSide('yes')} className={`flex-1 py-2 rounded-full font-bold ${side==='yes'?'bg-yes text-black':'bg-white/10'}`}>YES</button>
          <button onClick={()=>setSide('no')} className={`flex-1 py-2 rounded-full font-bold ${side==='no'?'bg-no text-white':'bg-white/10'}`}>NO</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {[1,5,10].map(v=> <button key={v} onClick={()=>setAmount(v)} className={`px-4 py-2 rounded-full ${amount===v?'bg-white text-black':'bg-white/10'}`}>${v}</button>)}
          <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} onBlur={refreshQuote} aria-label="Custom amount" className="ml-auto w-24 bg-black/30 border border-white/10 rounded px-3 py-2 min-h-[44px]" />
        </div>
        {quote && <p className="text-xs text-white/60 mt-3">Shares ~{quote.shares} · Fee ${quote.fee} · If {side.toUpperCase()} wins you get about ${quote.payoutIfWin}</p>}
        {!quote && <p className="text-xs text-white/60 mt-3">If {side.toUpperCase()} wins you get about ${amount}</p>}
        <TxStatus status={status} />
        {signingReady ? (
          /* When the lead's spike flips EMBEDDED_SIGNING_VERIFIED, the embedded-wallet
             signer (lib/privy.js resolveSigner → solana_signMessage) plugs in here. */
          <p className="text-xs text-yes mt-4" data-testid="bet-signing-open">Signing is active — bet flow handled by the wallet bridge.</p>
        ) : (
          <div className="mt-4 rounded-card border border-white/15 bg-white/5 p-3" data-testid="bet-signing-disabled-note">
            <p className="text-sm font-semibold text-white/80">Bet signing not yet available</p>
            <p className="text-xs text-white/55 mt-1">Wallet signing for bets is being verified; nothing was submitted. {PLAY_MONEY_LINE}</p>
          </div>
        )}
        <button onClick={onClose} className="w-full mt-4 bg-white text-black font-bold py-3 rounded-full" data-testid="trade-close">Close</button>
      </div>
    </div>
  );
}
