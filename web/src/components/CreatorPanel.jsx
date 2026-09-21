import { useState } from 'react';
import { templates } from '../lib/templates.js';
import { api } from '../lib/api.js';
import { getOrCreateGuestWallet, signObject } from '../lib/wallet.js';

export default function CreatorPanel({ roomId, onCreated }) {
  const [q, setQ] = useState(templates[0].question);
  const [rule, setRule] = useState(templates[0].resolutionRule);
  const [endMin, setEndMin] = useState(10);
  const [realQuote, setRealQuote] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function getRealQuote() {
    setError('');
    try {
      const res = await api.quoteMarket({ roomId, question: q, resolutionRule: rule, sourcesOfTruth:[window.location.href], endInMinutes:endMin, category:'gaming' });
      setRealQuote(res);
      setStatus('Real quote: fee ' + res.fee);
    } catch (e) { setError(e.message); }
  }
  async function handleCreate() {
    setError('');
    try {
      setStatus('Quoting...');
      const quote = await api.quoteMarket({ roomId, question: q, resolutionRule: rule, sourcesOfTruth:[window.location.href], endInMinutes:endMin, category:'gaming' });
      setStatus('Building...');
      const build = await api.buildMarket(quote.quoteId);
      setStatus('Signing...');
      const gw = getOrCreateGuestWallet();
      const sig = signObject(gw.secretKey, build.signPayload);
      setStatus('Registering...');
      const market = await api.registerMarket(quote.quoteId, sig);
      setStatus('Created!');
      onCreated?.(market);
    } catch (e) { setError(e.message); setStatus(''); }
  }

  return (
    <div className="bg-surface border border-white/10 rounded-card p-6">
      <h3 className="font-heading font-bold text-lg">Creator Panel</h3>
      <p className="text-xs text-white/50">Create in under 15 seconds from templates</p>
      <div className="grid grid-cols-2 gap-2 mt-4">
        {templates.map(t=> <button key={t.question} onClick={()=>{setQ(t.question); setRule(t.resolutionRule);}} className="text-left text-xs bg-white/5 hover:bg-white/10 rounded p-2 border border-white/5">{t.question}</button>)}
      </div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Question" className="w-full mt-4 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
      <input value={rule} onChange={e=>setRule(e.target.value)} placeholder="Resolution rule" className="w-full mt-2 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
      <select value={endMin} onChange={e=>setEndMin(Number(e.target.value))} className="w-full mt-2 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm">
        <option value={5}>5 minutes</option>
        <option value={10}>10 minutes</option>
        <option value={20}>20 minutes</option>
      </select>
      <div className="flex gap-2 mt-4">
        <button onClick={getRealQuote} className="flex-1 border border-white/20 rounded-full py-2 text-sm">Get real Panta quote</button>
        <button onClick={handleCreate} className="flex-1 bg-white text-black font-bold rounded-full py-2 text-sm">Create (sim)</button>
      </div>
      {realQuote && <p className="text-xs text-yes mt-2">Real fee: {realQuote.fee} {realQuote.currency || 'USDC'}</p>}
      {status && <p className="text-xs text-white/60 mt-2">{status}</p>}
      {error && <p className="text-xs text-no mt-2">{error}</p>}
      <p className="text-[10px] text-white/30 mt-3">Graduation ≥100 volume (sim assumption) · Fee 200 bps</p>
    </div>
  );
}
