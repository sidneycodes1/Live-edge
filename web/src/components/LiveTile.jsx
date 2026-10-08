import { Link } from 'react-router-dom';
import { PinButton, liveCardHref, liveCardState } from './LiveCard.jsx';
import { tileGradient, channelInitial } from '../lib/landing.js';

// ---------------------------------------------------------------------------
// LiveTile — the PLACEHOLDER tile for real Kick streams (contract §5/Agent C).
//
// Kick's API exposes NO per-stream thumbnail, so we render NO image AT ALL —
// never a fetched stand-in, never invented art (§1 honesty). The visual is a
// deterministic gradient derived from a hash of the channel slug (same channel
// → same gradient every visit), the channel's REAL initial, a LIVE badge (only
// when the row says isLive) and the REAL viewerCount — when viewerCount is null
// we render nothing, never a fake 0.
//
// Shared by the landing category grids AND any rail that lists live channels.
// ---------------------------------------------------------------------------

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

export default function LiveTile({ channel, pinned, onTogglePin }) {
  if (!channel) return null;
  const href = liveCardHref(channel);
  const initial = channelInitial(channel);
  // §1 honesty: show the count ONLY when the provider really gave one.
  const hasViewers = channel.viewerCount != null;
  return (
    <div className="relative">
      <PinButton pinned={pinned} onTogglePin={onTogglePin} channel={channel} className="absolute top-0 right-0" />
      <Link
        to={href || '/'}
        state={liveCardState(channel)}
        data-testid="live-tile"
        data-source={channel.source}
        className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition cursor-pointer"
      >
        {/* Placeholder area: deterministic gradient + channel initial. NOT an image. */}
        <div
          className="relative aspect-video overflow-hidden"
          style={{ backgroundImage: tileGradient(channel.channelSlug) }}
          data-testid="live-tile-gradient"
        >
          {initial && (
            <span
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center font-heading font-bold text-6xl text-white/85 drop-shadow-lg select-none"
            >
              {initial}
            </span>
          )}
          {channel.isLive && (
            <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          )}
          {hasViewers && (
            <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded num">
              {fmtViewers(channel.viewerCount)}
            </span>
          )}
        </div>
        <div className="p-3">
          <h3 className="font-heading font-bold text-sm leading-snug line-clamp-2">{channel.title || 'Live stream'}</h3>
          <div className="flex items-center gap-2 mt-1.5 text-xs min-w-0">
            <span className="truncate text-white/70">{channel.channelName || channel.channelSlug || channel.owner}</span>
            {channel.category && (
              <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-live/20 text-live">
                {channel.category}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
