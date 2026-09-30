import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MarketCard from '../components/MarketCard.jsx';
import TwitchLiveCard from '../components/TwitchLiveCard.jsx';
import Skeleton from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import WakeServer from '../components/WakeServer.jsx';

export default function Discover() {
  const [rooms, setRooms] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [twitch, setTwitch] = useState({ status: 'loading', items: [], enabled: false });
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (loading) setWaking(true); }, 2500);
    api.listRooms().then(r => { if (!cancelled) { setRooms(r); setLoading(false); } }).catch(() => { if (!cancelled) setLoading(false); });
    api.getCatalog().then(setCatalog).catch(() => {});
    // Independent of the simulated rooms: a slow/failing Twitch fetch must never
    // block or break the rest of Discover.
    api.listTwitchLive(12)
      .then(r => { if (!cancelled) setTwitch({ status: 'ready', items: r.items || [], enabled: Boolean(r.enabled) }); })
      .catch(() => { if (!cancelled) setTwitch({ status: 'error', items: [], enabled: false }); });
    return () => { cancelled = true; clearTimeout(t); };
  }, [loading]);

  // "Live on Twitch" — a clearly-labeled REAL layer, distinct from the simulated
  // rooms below. Hidden entirely when disabled or empty/degraded so it never looks
  // broken (see feature spec §Phase B).
  const showTwitch = twitch.status === 'ready' && twitch.enabled && twitch.items.length > 0;

  const roomsBlock = (!rooms || rooms.length === 0)
    ? <EmptyState title="No live rooms yet" body="Be the first to create a room and drop a market." />
    : (
      <>
        <h2 className="font-heading font-bold text-lg mt-2 text-white/80">Live Rooms <span className="text-xs font-normal text-white/40">(your simulated markets)</span></h2>
        <div className="grid md:grid-cols-3 gap-4 mt-3">
          {rooms.map(r => <MarketCard key={r.id} room={r} />)}
        </div>
      </>
    );

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6">{waking && <WakeServer />}<div className="grid md:grid-cols-3 gap-4 mt-4"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      {showTwitch && (
        <section className="mb-8" data-testid="twitch-live-section">
          <div className="flex items-center gap-2">
            <h2 className="font-heading font-bold text-xl">Live on Twitch</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-live/20 text-live px-2 py-0.5 rounded-full">real</span>
          </div>
          <p className="text-xs text-white/40 mt-1">Currently-live channels from Twitch. Opens real video + chat alongside a simulated market.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            {twitch.items.map(s => <TwitchLiveCard key={s.id} stream={s} />)}
          </div>
        </section>
      )}

      {roomsBlock}

      {catalog && catalog.items && catalog.items.length > 0 && (
        <div className="mt-8">
          <h2 className="font-heading font-bold">Real markets on Panta</h2>
          <p className="text-xs text-white/40">Read-only live catalog</p>
          <div className="flex gap-2 overflow-x-auto mt-2 pb-2">
            {catalog.items.slice(0, 6).map(m => <div key={m.id || m.question} className="min-w-[220px] bg-surface border border-white/10 rounded-card p-3 text-xs">{m.question || m.title || 'Market'}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
