import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import CreatorPanel from '../components/CreatorPanel.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import { useState } from 'react';
import { getOrCreateGuestWallet, signObject } from '../lib/wallet.js';

export default function Creator() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: room } = useApi(()=> roomId ? api.getRoom(roomId) : Promise.resolve(null), [roomId]);
  const { data: metrics } = useApi(()=> user ? api.metrics() : Promise.resolve(null), [user]);
  const [resolveOutcome, setResolveOutcome] = useState('yes');
  const [msg, setMsg] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  async function handleCreateRoom(e) {
    e.preventDefault();
    setCreateErr('');
    setCreating(true);
    try {
      const r = await api.createRoom(roomTitle.trim(), '');
      navigate(`/creator/${r.id}`);
    } catch (err) {
      setCreateErr(err.message || 'Could not create room');
      setCreating(false);
    }
  }

  async function handleResolve() {
    try {
      // resolve first market
      if (!room?.markets?.[0]) { setMsg('No market to resolve'); return; }
      await api.resolveMarket(room.markets[0].id, resolveOutcome, true);
      setMsg('Resolved '+resolveOutcome);
    } catch (e) { setMsg(e.message); }
  }

  if (!user) return <div className="max-w-3xl mx-auto px-4 py-10 text-center"><p className="text-white/60">Sign in to access creator cockpit</p></div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 space-y-6">
      <h1 className="font-heading font-bold text-2xl">Creator Cockpit</h1>
      {roomId ? (
        <>
          <CreatorPanel roomId={roomId} onCreated={()=>navigate(`/room/${roomId}`)} />
          <div className="bg-surface border border-white/10 rounded-card p-4">
            <h3 className="font-bold text-sm">Resolve (sim)</h3>
            <p className="text-xs text-white/50">Sim resolver (stands in for Panta's oracle)</p>
            <div className="flex gap-2 mt-3">
              <select value={resolveOutcome} onChange={e=>setResolveOutcome(e.target.value)} className="bg-black/30 border border-white/10 rounded px-3 py-2 text-sm">
                <option value="yes">YES</option><option value="no">NO</option>
              </select>
              <button onClick={handleResolve} className="bg-white text-black px-4 py-2 rounded-full text-sm font-bold">Resolve</button>
            </div>
            {msg && <p className="text-xs mt-2 text-yes">{msg}</p>}
          </div>
        </>
      ) : (
        <div className="bg-surface border border-white/10 rounded-card p-6">
          <h2 className="font-heading font-bold">Start a room</h2>
          <p className="text-xs text-white/50 mt-1 mb-4">Any signed-in account can create a room, then drop markets in it. Pick a room from Discover to manage an existing one.</p>
          <form onSubmit={handleCreateRoom} className="flex flex-col sm:flex-row gap-2">
            <input value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} required minLength={3} maxLength={80} placeholder="Room title (e.g. Friday ranked grind)" className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
            <button type="submit" disabled={creating} className="bg-white text-black px-4 py-2 rounded-full text-sm font-bold disabled:opacity-50">{creating ? 'Creating…' : 'Create room & open cockpit'}</button>
          </form>
          {createErr && <p className="text-xs text-no mt-2">{createErr}</p>}
        </div>
      )}
      {metrics && (
        <div className="bg-surface border border-white/10 rounded-card p-4">
          <h3 className="font-bold text-sm">Stats</h3>
          <p className="text-xs text-white/60 mt-1">Volume ${metrics.totalVolume} · Trades {metrics.tradeCount} · Traders {metrics.uniqueTraders}</p>
          <p className="text-xs text-white/40 mt-1">Creator fees accrued ${metrics.creatorFeesAccrued} — Creator fees unlock when a market graduates</p>
        </div>
      )}
    </div>
  );
}
