import { useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import { useSSE } from '../hooks/useSSE.js';
import VideoStage from '../components/VideoStage.jsx';
import MarketPanel from '../components/MarketPanel.jsx';
import ChatFeed from '../components/ChatFeed.jsx';
import TradeSheet from '../components/TradeSheet.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.js';

export default function Room() {
  const { id } = useParams();
  const { data: room, loading, setData } = useApi(()=>api.getRoom(id), [id]);
  const { events, viewers, lastUpdate } = useSSE(id);
  const [tradeSide, setTradeSide] = useState(null);
  const [activeMarket, setActiveMarket] = useState(null);
  const { user, signIn } = useAuth();

  useEffect(()=>{ if(room && room.markets && room.markets.length){ setActiveMarket(room.markets[0]); } }, [room]);
  // handle odds SSE to update price. Depends only on `events`; uses a functional
  // update that returns the SAME object when nothing actually changed, so it never
  // re-triggers itself (activeMarket is intentionally NOT a dependency).
  useEffect(()=>{
    const lastOdds = [...events].reverse().find(e=>e.type==='odds');
    if (!lastOdds) return;
    setActiveMarket(m => {
      if (!m || lastOdds.data.marketId !== m.id) return m;
      if (m.yes_price===lastOdds.data.yesPrice && m.no_price===lastOdds.data.noPrice && m.volume===lastOdds.data.volume) return m;
      return { ...m, yes_price:lastOdds.data.yesPrice, no_price:lastOdds.data.noPrice, volume:lastOdds.data.volume };
    });
  }, [events]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6"><Skeleton className="h-[400px]" /></div>;
  if (!room) return <div className="p-6">Room not found</div>;

  const handleTrade = (side) => {
    if (!user) { signIn(); return; }
    setTradeSide(side);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <div className="flex items-center gap-2 text-xs text-white/50">
        <span className="w-2 h-2 bg-live rounded-full animate-pulse inline-block" /> LIVE · {viewers} viewers · Last updated {lastUpdate ? `${Math.round((Date.now()-lastUpdate.getTime())/1000)}s ago` : 'now'}
      </div>
      <h1 className="font-heading font-bold text-xl mt-2">{room.title}</h1>
      <div className="grid md:grid-cols-[65%_35%] gap-4 mt-4">
        <div className="space-y-4">
          <VideoStage videoUrl={room.video_url} />
          <ChatFeed messages={room.chat||[]} sseEvents={events} />
        </div>
        <div className="space-y-4">
          {activeMarket && <MarketPanel market={activeMarket} onTrade={handleTrade} />}
          {room.markets && room.markets.length>1 && (
            <div className="space-y-2">
              {room.markets.map(m=> <button key={m.id} onClick={()=>setActiveMarket(m)} className={`w-full text-left p-3 rounded-card border text-sm ${activeMarket?.id===m.id?'bg-white text-black':'bg-surface border-white/10'}`}>{m.question}</button>)}
            </div>
          )}
        </div>
      </div>
      {tradeSide && activeMarket && <TradeSheet market={activeMarket} side={tradeSide} onClose={()=>setTradeSide(null)} onSuccess={()=>{ api.getRoom(id).then(setData); }} />}
    </div>
  );
}
