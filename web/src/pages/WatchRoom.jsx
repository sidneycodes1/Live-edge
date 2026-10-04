import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeLive } from '../lib/live.js';
import { useTwitchConfig } from '../hooks/useTwitchConfig.js';
import FeedEmbed from '../components/FeedEmbed.jsx';
import VideoStage from '../components/VideoStage.jsx';

// Generic watch surface for a non-Twitch LiveChannel opened from the grid. It finds
// the channel in the (fresh) /api/live feed by source+slug and hands it to the
// provider-agnostic FeedEmbed. Twitch rows route to /twitch/:login instead, so this
// is YouTube/Kick/Floor. If the stream has since dropped from the feed we keep the
// honest simulated fallback and offer the outbound watch link — never a dead box.
export default function WatchRoom() {
  const { source, slug } = useParams();
  const { parent } = useTwitchConfig();
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getLive(100)
      .then((raw) => {
        if (cancelled) return;
        const { items } = normalizeLive(raw);
        const found = items.find(
          (c) =>
            c.source === source &&
            (c.channelSlug === slug || c.id === slug || c.id === `${source}:${slug}`),
        );
        setChannel(found || null);
      })
      .catch(() => { if (!cancelled) setChannel(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source, slug]);

  const ch = channel || { source, channelSlug: decodeURIComponent(slug || ''), title: '', channelName: '', watchUrl: null, viewerCount: 0, thumbnailUrl: '' };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <div className="flex items-center gap-2 text-xs text-white/50">
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-live/20 text-live px-2 py-0.5 rounded-full">real {source}</span>
        {loading && <span>loading…</span>}
      </div>
      <h1 className="font-heading font-bold text-xl mt-2">{ch.title || decodeURIComponent(slug || '')}</h1>
      {ch.channelName && <p className="text-xs text-white/45 mt-1">{ch.channelName}</p>}

      <div className="mt-4 grid md:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4 min-w-0">
          <FeedEmbed channel={ch} parent={parent} fallback={<VideoStage videoUrl={null} />} />
          <div className="bg-surface border border-white/10 rounded-card p-4">
            <p className="text-sm text-white/70">No prediction market is attached to this stream yet.</p>
            <p className="text-xs text-white/45 mt-1">Watch the real feed here, or open a simulated market on it.</p>
            <Link to="/creator" className="inline-block mt-3 px-4 py-2 rounded-card bg-white text-black text-sm font-semibold cursor-pointer hover:bg-white/90 transition">
              Create a market →
            </Link>
          </div>
        </div>
        <div className="hidden md:block">
          <div className="h-[420px] md:h-[calc(100vh-8rem)] md:sticky md:top-4 rounded-card overflow-hidden border border-white/10 grid place-items-center text-white/40 text-sm bg-black/20 px-4 text-center">
            {source === 'twitch'
              ? 'Twitch chat lives on the Twitch watch page.'
              : 'Live chat for this provider isn’t verified yet — the market feed is the social layer here.'}
          </div>
        </div>
      </div>
    </div>
  );
}
