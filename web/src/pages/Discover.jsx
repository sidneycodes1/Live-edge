import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MarketCard from '../components/MarketCard.jsx';
import Skeleton from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import WakeServer from '../components/WakeServer.jsx';

export default function Discover() {
  const [rooms, setRooms] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);

  useEffect(()=>{
    let cancelled=false;
    const t=setTimeout(()=>{ if(loading) setWaking(true); }, 2500);
    api.listRooms().then(r=>{ if(!cancelled){ setRooms(r); setLoading(false);}}).catch(()=>{ if(!cancelled) setLoading(false); });
    api.getCatalog().then(setCatalog).catch(()=>{});
    return ()=>{ cancelled=true; clearTimeout(t); };
  }, [loading]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6">{waking && <WakeServer /> }<div className="grid md:grid-cols-3 gap-4 mt-4"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div></div>;
  if (!rooms || rooms.length===0) return <div className="max-w-6xl mx-auto px-4 py-6"><EmptyState title="No live rooms yet" body="Be the first to create a room and drop a market." /></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <h1 className="font-heading font-bold text-2xl">Live Rooms</h1>
      <div className="grid md:grid-cols-3 gap-4 mt-6">
        {rooms.map(r=> <MarketCard key={r.id} room={r} />)}
      </div>
      {catalog && catalog.items && catalog.items.length>0 && (
        <div className="mt-8">
          <h2 className="font-heading font-bold">Real markets on Panta</h2>
          <p className="text-xs text-white/40">Read-only live catalog</p>
          <div className="flex gap-2 overflow-x-auto mt-2 pb-2">
            {catalog.items.slice(0,6).map(m=> <div key={m.id||m.question} className="min-w-[220px] bg-surface border border-white/10 rounded-card p-3 text-xs">{m.question || m.title || 'Market'}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
