import { Link } from 'react-router-dom';

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

// A Twitch-style browse card: 16:9 thumbnail with a LIVE badge + real viewer
// count overlaid, then title / channel / game. Opens a Twitch-backed room.
// Data comes from GET /api/twitch/live (server-normalized from Helix get-streams).
export default function TwitchLiveCard({ stream }) {
  const login = stream.userLogin;
  return (
    <Link
      to={`/twitch/${encodeURIComponent(login)}`}
      data-testid="twitch-live-card"
      className="block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition"
    >
      <div className="relative aspect-video bg-black/40">
        {stream.thumbnailUrl ? (
          <img
            src={stream.thumbnailUrl}
            alt={stream.title || `${stream.userName} live`}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs">no preview</div>
        )}
        <span className="absolute top-2 left-2 bg-live text-white text-[10px] font-bold px-1.5 py-0.5 rounded">LIVE</span>
        <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
          {fmtViewers(stream.viewerCount)} viewers
        </span>
      </div>
      <div className="p-3">
        <h3 className="font-heading font-bold text-sm line-clamp-2">{stream.title || 'Live stream'}</h3>
        <p className="text-xs text-white/70 mt-1 truncate">{stream.userName || login}</p>
        {stream.gameName && <p className="text-[11px] text-white/45 mt-0.5 truncate">{stream.gameName}</p>}
      </div>
    </Link>
  );
}
