import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { usePanelModal } from '../hooks/usePanelModal.jsx';
import CreatorPanel from '../components/CreatorPanel.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import { useState } from 'react';
import { isValidKickSlug } from '../lib/kick.js';

// Create as an OVERLAY body (owner decision, Oct 2026): rendered inside
// <PanelOverlay/>'s <Modal>. It is prop-driven (no route params) and keeps its
// whole two-step flow INSIDE the overlay — "Start a room" → cockpit swaps in
// place (no navigation), so there is always a ✕ back. Only finishing a market
// leaves the overlay, handing you to the live room to watch your bet.
export default function Creator({ roomId = null, prefillTitle = '', prefillChannel = '' }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  const { closePanel } = usePanelModal();
  // The room whose cockpit we show. Seeded from the opener (in-room "+ Start a
  // bet" passes roomId); set locally once a new room is created, WITHOUT routing.
  const [activeRoomId, setActiveRoomId] = useState(roomId);
  const { data: room } = useApi(() => (activeRoomId ? api.getRoom(activeRoomId) : Promise.resolve(null)), [activeRoomId]);
  const { data: metrics } = useApi(() => (user ? api.metrics() : Promise.resolve(null)), [user]);
  const [resolveOutcome, setResolveOutcome] = useState('yes');
  const [msg, setMsg] = useState('');
  const [roomTitle, setRoomTitle] = useState(prefillTitle);
  const [roomChannel, setRoomChannel] = useState(prefillChannel);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  async function handleCreateRoom(e) {
    e.preventDefault();
    setCreateErr('');
    const ch = roomChannel.trim();
    setCreating(true);
    try {
      // Validate a supplied channel against Kick before saving — don't accept garbage.
      if (ch) {
        if (!isValidKickSlug(ch)) { setCreateErr('That doesn’t look like a valid Kick channel name.'); setCreating(false); return; }
        try {
          const v = await api.validateKickChannel(ch);
          if (v.verifiable && !v.exists) { setCreateErr(`Kick channel “${ch}” doesn’t exist.`); setCreating(false); return; }
          if (!v.verifiable) setMsg('Kick creds not configured — channel attached but unverified (real video embed still renders).');
          else setMsg(v.isLive ? `Attached ${ch} (live now).` : `Attached ${ch} (exists; offline right now).`);
        } catch {
          /* validation endpoint failed — proceed, server also validates on create */
        }
      }
      const r = await api.createRoom(roomTitle.trim(), '', ch || undefined);
      setActiveRoomId(r.id); // swap to the cockpit inside the same overlay
    } catch (err) {
      setCreateErr(err.message || 'Could not create room');
      setCreating(false);
    }
  }

  async function handleResolve() {
    try {
      if (!room?.markets?.[0]) { setMsg('No market to resolve'); return; }
      await api.resolveMarket(room.markets[0].id, resolveOutcome, true);
      setMsg('Resolved ' + resolveOutcome);
    } catch (e) { setMsg(e.message); }
  }

  // A finished market: close the overlay and open the live room to watch it.
  function handleMarketCreated() {
    closePanel();
    navigate(`/room/${activeRoomId}`);
  }

  if (!user) {
    return (
      <div className="py-6 text-center" data-testid="creator-signed-out">
        <h2 id="creator-modal-title" className="font-heading font-bold text-xl">Create a bet</h2>
        <p className="mt-3 mb-4 text-sm text-white/70">Sign in to open the creator cockpit and start a market.</p>
        <button onClick={openAuth} className="bg-brand text-brand-ink px-6 py-2 rounded-full font-bold min-h-[44px]">Sign in</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="creator-modal-body">
      <h2 id="creator-modal-title" className="font-heading font-bold text-2xl">Creator Cockpit</h2>
      {activeRoomId ? (
        <>
          <CreatorPanel roomId={activeRoomId} onCreated={handleMarketCreated} />
          <div className="bg-surface border border-white/10 rounded-card p-4">
            <h3 className="font-bold text-sm">Resolve (sim)</h3>
            <p className="text-xs text-white/50">Sim resolver (stands in for Panta's oracle)</p>
            <div className="flex gap-2 mt-3">
              <select value={resolveOutcome} onChange={e => setResolveOutcome(e.target.value)} className="bg-black/30 border border-white/10 rounded px-3 py-2 text-sm">
                <option value="yes">YES</option><option value="no">NO</option>
              </select>
              <button onClick={handleResolve} className="bg-brand text-brand-ink px-4 py-2 rounded-full text-sm font-bold">Resolve</button>
            </div>
            {msg && <p className="text-xs mt-2 text-yes">{msg}</p>}
          </div>
        </>
      ) : (
        <div className="bg-surface border border-white/10 rounded-card p-6">
          <h3 className="font-heading font-bold">Start a room</h3>
          <p className="text-xs text-white/50 mt-1 mb-4">Any signed-in account can create a room, then drop markets in it. Pick a room from Discover to manage an existing one.</p>
          <form onSubmit={handleCreateRoom} className="flex flex-col gap-2">
            <input value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} required minLength={3} maxLength={80} placeholder="Room title (e.g. Friday ranked grind)" className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
            <input value={roomChannel} onChange={(e) => setRoomChannel(e.target.value)} maxLength={40} placeholder="Attach a live Kick channel (optional) — e.g. amouranth" className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" />
            <button type="submit" disabled={creating} className="bg-brand text-brand-ink px-4 py-2 rounded-full text-sm font-bold disabled:opacity-50">{creating ? 'Creating…' : 'Create room & open cockpit'}</button>
          </form>
          {msg && <p className="text-xs text-yes mt-2">{msg}</p>}
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
