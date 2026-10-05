import { useState } from 'react';
import { templates } from '../lib/templates.js';
import { api } from '../lib/api.js';
import { useToast } from '../hooks/useToast.js';
import { useBalance } from '../hooks/useBalance.js';
import { getOrCreateGuestWallet, signObject } from '../lib/wallet.js';

export default function CreatorPanel({ roomId, onCreated }) {
  const { showToast } = useToast();
  const { balance } = useBalance();
  const [q, setQ] = useState(templates[0].question);
  const [rule, setRule] = useState(templates[0].resolutionRule);
  const [endMin, setEndMin] = useState(10);
  const [quote, setQuote] = useState(null); // { quoteId, fee, source } — shown BEFORE confirm
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Step 1: quote the creation fee so it is a visible cost before the user commits,
  // exactly like the trade sheet previews cost before "Confirm".
  async function handlePreview() {
    setError('');
    setQuote(null);
    try {
      setStatus('Quoting…');
      const res = await api.quoteMarket({ roomId, question: q, resolutionRule: rule, sourcesOfTruth: [window.location.href], endInMinutes: endMin, category: 'gaming' });
      setQuote(res);
      setStatus('');
    } catch (e) { setError(e.message); setStatus(''); }
  }

  // Step 2: confirm -> build, sign, register (the server deducts the fee here, F-010).
  async function handleConfirm() {
    if (!quote) return;
    setError('');
    try {
      setStatus('Building…');
      const build = await api.buildMarket(quote.quoteId);
      setStatus('Signing…');
      const gw = getOrCreateGuestWallet();
      const sig = signObject(gw.secretKey, build.signPayload);
      setStatus('Registering…');
      const market = await api.registerMarket(quote.quoteId, sig);
      setStatus('Created!');
      setQuote(null);
      showToast(`Market created! $${Number(quote.fee).toFixed(2)} creation fee deducted.`);
      onCreated?.(market);
    } catch (e) { setError(e.message); setStatus(''); }
  }

  const fee = quote ? Number(quote.fee) : null;
  const feeLabel = quote?.source === 'panta' ? 'Panta live fee' : 'Simulated fee (demo)';
  const shortByFee = balance != null && fee != null && balance < fee;

  return (
    <div className="bg-surface border border-white/10 rounded-card p-6">
      <h3 className="font-heading font-bold text-lg">Creator Panel</h3>
      <p className="text-xs text-white/50">Create in under 15 seconds from templates</p>
      <div className="grid grid-cols-2 gap-2 mt-4">
        {templates.map((t) => <button key={t.question} onClick={() => { setQ(t.question); setRule(t.resolutionRule); setQuote(null); }} className="text-left text-xs bg-white/5 hover:bg-white/10 rounded p-2 border border-white/5">{t.question}</button>)}
      </div>
      <input value={q} onChange={(e) => { setQ(e.target.value); setQuote(null); }} placeholder="Question" className="w-full mt-4 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
      <input value={rule} onChange={(e) => { setRule(e.target.value); setQuote(null); }} placeholder="Resolution rule" className="w-full mt-2 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
      <select value={endMin} onChange={(e) => { setEndMin(Number(e.target.value)); setQuote(null); }} className="w-full mt-2 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm">
        <option value={5}>5 minutes</option>
        <option value={10}>10 minutes</option>
        <option value={20}>20 minutes</option>
      </select>

      {!quote ? (
        <button onClick={handlePreview} disabled={status === 'Quoting…'} className="w-full mt-4 bg-white text-black font-bold rounded-full py-2 min-h-[44px] text-sm disabled:opacity-50">Preview creation fee</button>
      ) : (
        <div className="mt-4 border border-white/15 rounded-card p-4 bg-black/20" data-testid="fee-preview">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/70">Creation fee</span>
            <span className="num font-bold">${fee.toFixed(2)}</span>
          </div>
          <p className="text-[11px] text-white/45 mt-1">
            {feeLabel} · deducted from your balance (${balance != null ? balance.toFixed(2) : '—'}) on confirm.
          </p>
          {shortByFee && <p className="text-xs text-no mt-2">Insufficient balance for this fee — use the faucet or a smaller action.</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setQuote(null); setError(''); }} className="flex-1 border border-white/20 rounded-full py-2 min-h-[44px] text-sm">Cancel</button>
            <button onClick={handleConfirm} disabled={shortByFee || status === 'Building…' || status === 'Signing…' || status === 'Registering…'} className="flex-1 bg-white text-black font-bold rounded-full py-2 min-h-[44px] text-sm disabled:opacity-50" data-testid="confirm-create">Confirm &amp; create</button>
          </div>
        </div>
      )}
      {status && <p className="text-xs text-white/60 mt-2">{status}</p>}
      {error && <p className="text-xs text-no mt-2" data-testid="creator-error">{error}</p>}
      <p className="text-[10px] text-white/30 mt-3">Graduation ≥100 volume (sim assumption) · Trade fee 200 bps</p>
    </div>
  );
}
