import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useTwitchConfig } from '../hooks/useTwitchConfig.js';
import TwitchVideo from '../components/TwitchVideo.jsx';
import TwitchChat from '../components/TwitchChat.jsx';

// Opened from a Discover "Live on Twitch" card. Shows the REAL video + chat for
// the channel. If a LiveEdge room already binds this channel (seeded fallback or
// a creator-attached market), we hand off to that room so the market panel shows;
// otherwise we offer a CTA to create one (Phase D). Video/chat embeds work with NO
// API creds (only the Helix browse list needs them), so this degrades cleanly.
export default function TwitchRoom() {
  const { login } = useParams();
  const channel = decodeURIComponent(login || '');
  const { parent } = useTwitchConfig();
  const [rooms, setRooms] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listRooms().then(r => { if (!cancelled) setRooms(r || []); }).catch(() => { if (!cancelled) setRooms([]); });
    return () => { cancelled = true; };
  }, []);

  const existing = (rooms || []).find(r => (r.twitch_channel || '').toLowerCase() === channel.toLowerCase());
  if (existing) return <Navigate to={`/room/${existing.id}`} replace />;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <div className="flex items-center gap-2 text-xs text-white/50">
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-live/20 text-live px-2 py-0.5 rounded-full">real twitch</span>
      </div>
      <h1 className="font-heading font-bold text-xl mt-2">{channel}</h1>
      <div className="mt-4 grid md:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4 min-w-0">
          <TwitchVideo channel={channel} parent={parent} />
          <div className="bg-surface border border-white/10 rounded-card p-4">
            <p className="text-sm text-white/70">No prediction market is attached to this channel yet.</p>
            <p className="text-xs text-white/45 mt-1">You can watch the real stream &amp; chat here, and optionally open a simulated market on it.</p>
            <Link to={`/creator?twitchChannel=${encodeURIComponent(channel)}`}
              className="inline-block mt-3 px-4 py-2 rounded-card bg-white text-black text-sm font-semibold">
              Create a market on {channel} →
            </Link>
          </div>
        </div>
        <div className="h-[420px] md:h-[calc(100vh-8rem)] md:sticky md:top-4 rounded-card overflow-hidden border border-white/10">
          <TwitchChat channel={channel} parent={parent} />
        </div>
      </div>
    </div>
  );
}
