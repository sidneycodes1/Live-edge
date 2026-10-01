import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import { useSSE } from '../hooks/useSSE.js';
import RoomFeed from '../components/RoomFeed.jsx';
import TwitchVideo from '../components/TwitchVideo.jsx';
import TwitchChat from '../components/TwitchChat.jsx';
import { useTwitchConfig } from '../hooks/useTwitchConfig.js';
import MarketPanel from '../components/MarketPanel.jsx';
import ChatFeed from '../components/ChatFeed.jsx';
import RecentBetsTicker from '../components/RecentBetsTicker.jsx';
import TradeSheet from '../components/TradeSheet.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.js';

function LiveHeader({ viewers, lastUpdate }) {
  return (
    <div className="flex items-center gap-2 text-xs text-white/50">
      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block" /> LIVE · {viewers} {viewers === 1 ? 'viewer' : 'viewers'} · Last updated {lastUpdate ? `${Math.round((Date.now() - lastUpdate.getTime()) / 1000)}s ago` : 'now'}
    </div>
  );
}

// Contextual in-room create (plan §6): the primary way to add a bet is FROM the
// stream you're watching. Reuses the existing Creator cockpit, pre-filled with
// this room. Top-nav "Create" stays as the standalone secondary path.
function InRoomCreate({ roomId }) {
  return (
    <Link
      to={`/creator/${roomId}`}
      data-testid="in-room-create"
      className="block w-full text-center bg-white/5 hover:bg-white/10 border border-dashed border-white/20 rounded-card py-2.5 text-sm font-semibold text-white/80 transition"
    >
      + Start a bet on this stream
    </Link>
  );
}

export default function Room() {
  const { id } = useParams();
  const { data: room, loading, setData } = useApi(() => api.getRoom(id), [id]);
  const { events, viewers, lastUpdate } = useSSE(id);
  const { parent } = useTwitchConfig();
  const [tradeSide, setTradeSide] = useState(null);
  const [activeMarket, setActiveMarket] = useState(null);
  const [mobileTab, setMobileTab] = useState('chat'); // Twitch rooms only: 'chat' | 'market'
  const { user, signIn } = useAuth();

  useEffect(() => { if (room && room.markets && room.markets.length) { setActiveMarket(room.markets[0]); } }, [room]);
  // handle odds SSE to update price. Depends only on `events`; uses a functional
  // update that returns the SAME object when nothing actually changed, so it never
  // re-triggers itself (activeMarket is intentionally NOT a dependency).
  useEffect(() => {
    const lastOdds = [...events].reverse().find(e => e.type === 'odds');
    if (!lastOdds) return;
    setActiveMarket(m => {
      if (!m || lastOdds.data.marketId !== m.id) return m;
      if (m.yes_price === lastOdds.data.yesPrice && m.no_price === lastOdds.data.noPrice && m.volume === lastOdds.data.volume) return m;
      return { ...m, yes_price: lastOdds.data.yesPrice, no_price: lastOdds.data.noPrice, volume: lastOdds.data.volume };
    });
  }, [events]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6"><Skeleton className="h-[400px]" /></div>;
  if (!room) return <div className="p-6">Room not found</div>;

  const handleTrade = (side) => {
    if (!user) { signIn(); return; }
    setTradeSide(side);
  };

  const refetch = () => { api.getRoom(id).then(setData); };

  // ---- Twitch-backed room: REAL video + REAL chat alongside the (still simulated)
  // market panel. Desktop: video large, market below it, chat a fixed-width sidebar
  // (never overlapping). Mobile: video, then a Chat/Market toggle (no room for a
  // permanent sidebar). If the channel drops, TwitchVideo shows an offline state and
  // the market panel keeps working. ----
  if (room.twitch_channel) {
    const ch = room.twitch_channel;
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
        <LiveHeader viewers={viewers} lastUpdate={lastUpdate} />
        <h1 className="font-heading font-bold text-xl mt-2">{room.title}</h1>
        <p className="text-xs text-white/45 mt-1">
          Real Twitch stream: <span className="text-white/70">{ch}</span> · live video &amp; chat from Twitch, simulated prediction market
        </p>
        <div className="mt-4 grid md:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4 min-w-0">
            <TwitchVideo channel={ch} parent={parent} />
            <RecentBetsTicker events={events} />
            {/* mobile-only switch between chat and market */}
            <div className="md:hidden flex gap-2">
              {['chat', 'market'].map(t => (
                <button key={t} onClick={() => setMobileTab(t)}
                  className={`flex-1 py-2 rounded-card text-sm font-semibold border ${mobileTab === t ? 'bg-white text-black border-white' : 'bg-surface text-white/70 border-white/10'}`}>
                  {t === 'chat' ? 'Chat' : 'Market'}
                </button>
              ))}
            </div>
            <div className={`${mobileTab === 'market' ? 'block' : 'hidden'} md:block space-y-3`}>
              <InRoomCreate roomId={id} />
              {activeMarket
                ? <MarketPanel market={activeMarket} onTrade={handleTrade} />
                : <div className="bg-surface border border-white/10 rounded-card p-4 text-sm text-white/50">No market attached to this channel yet.</div>}
              {room.markets && room.markets.length > 1 && (
                <div className="space-y-2 mt-3">
                  {room.markets.map(m => <button key={m.id} onClick={() => setActiveMarket(m)} className={`w-full text-left p-3 rounded-card border text-sm ${activeMarket?.id === m.id ? 'bg-white text-black' : 'bg-surface border-white/10'}`}>{m.question}</button>)}
                </div>
              )}
            </div>
          </div>
          <div className={`${mobileTab === 'chat' ? 'block' : 'hidden'} md:block`}>
            <div className="h-[420px] md:h-[calc(100vh-8rem)] md:sticky md:top-4 rounded-card overflow-hidden border border-white/10">
              <TwitchChat channel={ch} parent={parent} />
            </div>
          </div>
        </div>
        {tradeSide && activeMarket && <TradeSheet market={activeMarket} side={tradeSide} onClose={() => setTradeSide(null)} onSuccess={refetch} />}
      </div>
    );
  }

  // ---- Simulated / creator room WITHOUT a real channel. Desktop: video + chat
  // left, market right. Mobile: video always on top, then a Chat/Market toggle
  // (F-029) so the market isn't buried under a long chat scroll. ----
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <LiveHeader viewers={viewers} lastUpdate={lastUpdate} />
      <h1 className="font-heading font-bold text-xl mt-2">{room.title}</h1>
      <div className="grid md:grid-cols-[65%_35%] gap-4 mt-4">
        <div className="space-y-4 min-w-0">
          <RoomFeed videoUrl={room.video_url} parent={parent} />
          <RecentBetsTicker events={events} />
          {/* mobile-only switch between chat and market */}
          <div className="md:hidden flex gap-2">
            {['chat', 'market'].map(t => (
              <button key={t} onClick={() => setMobileTab(t)}
                className={`flex-1 py-2 rounded-card text-sm font-semibold border ${mobileTab === t ? 'bg-white text-black border-white' : 'bg-surface text-white/70 border-white/10'}`}>
                {t === 'chat' ? 'Chat' : 'Market'}
              </button>
            ))}
          </div>
          <div className={`${mobileTab === 'chat' ? 'block' : 'hidden'} md:block`}>
            <ChatFeed messages={room.chat || []} sseEvents={events} />
          </div>
        </div>
        <div className={`${mobileTab === 'market' ? 'block' : 'hidden'} md:block space-y-4`}>
          <InRoomCreate roomId={id} />
          {activeMarket && <MarketPanel market={activeMarket} onTrade={handleTrade} />}
          {room.markets && room.markets.length > 1 && (
            <div className="space-y-2">
              {room.markets.map(m => <button key={m.id} onClick={() => setActiveMarket(m)} className={`w-full text-left p-3 rounded-card border text-sm ${activeMarket?.id === m.id ? 'bg-white text-black' : 'bg-surface border-white/10'}`}>{m.question}</button>)}
            </div>
          )}
        </div>
      </div>
      {tradeSide && activeMarket && <TradeSheet market={activeMarket} side={tradeSide} onClose={() => setTradeSide(null)} onSuccess={refetch} />}
    </div>
  );
}
