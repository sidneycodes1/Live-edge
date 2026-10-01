import { Link } from 'react-router-dom';
import { IconPlay } from './Icons.jsx';

// A grid tile for any LiveChannel (twitch/kick/youtube/floor). It is deliberately
// provider-agnostic: the SAME card reads for any source, and honesty rules from
// docs/live-aggregation-spec.md §4 are enforced here —
//   • empty thumbnailUrl → a neutral "no preview" tile (never a fabricated URL)
//   • viewerCount 0 (a provider that exposes none) → "—", not a made-up number
//   • floor rows are labeled as the config fallback, not presented as a real broadcast
const SOURCE_LABEL = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', floor: 'Fallback' };

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '—';                 // honest: provider exposes no count
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

// Twitch keeps its dedicated, already-tested watch surface; every other source
// opens the generic provider-agnostic watch room.
export function liveCardHref(ch) {
  if (!ch) return '/';
  if (ch.source === 'twitch' && ch.channelSlug) return `/twitch/${encodeURIComponent(ch.channelSlug)}`;
  const slug = ch.channelSlug || ch.id;
  return `/watch/${encodeURIComponent(ch.source || 'live')}/${encodeURIComponent(slug)}`;
}

export default function LiveCard({ channel }) {
  const isFloor = channel.source === 'floor';
  const viewers = fmtViewers(channel.viewerCount);
  return (
    <Link
      to={liveCardHref(channel)}
      data-testid="live-card"
      data-source={channel.source}
      className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition cursor-pointer"
    >
      <div className="relative aspect-video bg-black/40">
        {channel.thumbnailUrl ? (
          <img
            src={channel.thumbnailUrl}
            alt={channel.title || `${channel.channelName} live`}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.remove(); }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#141420] via-surface to-black text-white/30">
            <IconPlay className="w-8 h-8" />
            <span className="absolute bottom-2 text-[11px]">no preview</span>
          </div>
        )}
        {/* LIVE badge (top-left) + viewer count (bottom-right) mirror browse grammar */}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </span>
        <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded num">{viewers}</span>
      </div>

      <div className="p-3">
        <h3 className="font-heading font-bold text-sm leading-snug line-clamp-2">{channel.title || 'Live stream'}</h3>
        <div className="flex items-center gap-2 mt-1.5 text-xs min-w-0">
          <span className="truncate text-white/70">{channel.channelName || channel.channelSlug}</span>
          <span className="ml-auto shrink-0 flex items-center gap-1.5">
            {channel.category && <span className="truncate text-white/45 capitalize max-w-[8rem]">{channel.category}</span>}
            <span
              className={
                'shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' +
                (isFloor ? 'bg-white/10 text-white/55' : 'bg-live/20 text-live')
              }
            >
              {SOURCE_LABEL[channel.source] || 'live'}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
