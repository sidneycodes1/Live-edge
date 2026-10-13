import { Link } from 'react-router-dom';
import { extractYouTubeVideoId, extractYouTubeChannelId } from '../lib/embed.js';
import { IconPin } from './Icons.jsx';

// ---------------------------------------------------------------------------
// The playable card for the "Live now" grid (docs/live-aggregation-spec.md §4
// honesty): a real broadcast — its OWN thumbnail, a LIVE badge, title, channel
// and a category chip. A viewer count is shown ONLY when the provider actually
// exposes one (curated 24/7 rows carry none → we render nothing, never a
// fabricated 0). Clicking opens the in-app watch/embed view.
//
// (The football score-card kind was retired Oct 2026 with the API-Football
// vertical.) No "no preview" tiles, no equalizers, no placeholder art anywhere.
// ---------------------------------------------------------------------------

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

// A short, URL-safe title slug appended to YouTube watch URLs so a shared link
// reads as "…/watch/youtube/<videoId>/some-title" instead of a bare id. It is
// COSMETIC ONLY — WatchRoom keys off the videoId, never this segment.
function titleSlug(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Where a card links. YouTube is keyed by the VIDEO id (the aggregator's
// `channelSlug` is the UC CHANNEL id — using it produced rooms that could not be
// re-found in the rotating grid). Curated 24/7 rows are keyed by their UC channel
// id (they embed by channel, live_stream?channel=UC…).
export function liveCardHref(ch) {
  if (!ch) return null;
  if (ch.source === 'youtube') {
    const vid = extractYouTubeVideoId(ch);
    if (vid) {
      const slug = titleSlug(ch.title);
      return `/watch/youtube/${encodeURIComponent(vid)}${slug ? `/${slug}` : ''}`;
    }
    // No video id (rare/degraded) → fall back to the channel id we do have.
    const cid = extractYouTubeChannelId(ch);
    return `/watch/youtube/${encodeURIComponent(cid || ch.channelSlug || ch.id || '')}`;
  }
  if (ch.source === 'curated-youtube') {
    const cid = extractYouTubeChannelId(ch);
    if (cid) return `/watch/curated-youtube/${encodeURIComponent(cid)}`;
    const vid = extractYouTubeVideoId({ watchUrl: ch.videoUrl || ch.watchUrl, id: '' });
    return `/watch/curated-youtube/${encodeURIComponent(vid || ch.id || '')}`;
  }
  if (ch.source === 'kick') {
    return `/watch/kick/${encodeURIComponent(ch.channelSlug || ch.id || '')}`;
  }
  // Floor (and anything else) → generic watch keyed by the row id.
  return `/watch/${encodeURIComponent(ch.source || 'live')}/${encodeURIComponent(ch.id || ch.channelSlug || '')}`;
}

// Minimal channel data carried through router `state` so WatchRoom can render the
// room DIRECTLY from the URL + this payload — never depending on finding the item
// again in the rotating /api/live grid. Only real fields; nothing invented.
export function liveCardState(ch) {
  if (!ch) return undefined;
  return {
    source: ch.source,
    title: ch.title || '',
    channelName: ch.channelName || '',
    channelSlug: ch.channelSlug || '',
    thumbnailUrl: ch.thumbnailUrl || '',
    videoId: extractYouTubeVideoId(ch) || undefined,
    channelId: extractYouTubeChannelId(ch) || undefined,
    watchUrl: ch.watchUrl || undefined,
    liveEmbedUrl: ch.liveEmbedUrl || undefined,
    videoUrl: ch.videoUrl || undefined,
    viewerCount: ch.viewerCount == null ? null : ch.viewerCount,
  };
}

// Pin toggle — "I'm watching / playing with this stream": it leads the Live now
// grid (max 4, server-authoritative). Rendered OUTSIDE the <Link> so pressing it
// never navigates. Only appears once the caller wires onTogglePin up.
// Tap rule: the BUTTON box is 44×44 (effective hit-area) while the visible
// circle stays 28px, centred inside it — corner anchors below account for the
// 8px transparent padding so the visual lands exactly where it did before.
export function PinButton({ pinned, onTogglePin, channel, className = '' }) {
  if (!onTogglePin) return null;
  return (
    <button
      type="button"
      data-testid="pin-toggle"
      aria-pressed={Boolean(pinned)}
      aria-label={pinned ? 'Unpin stream' : 'Pin stream to the front of Live now'}
      title={pinned ? 'Unpin' : 'Pin to Live now (max 4)'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTogglePin(channel);
      }}
      className={`z-10 w-11 h-11 grid place-items-center cursor-pointer group ${className}`}
    >
      <span
        aria-hidden="true"
        className={`w-7 h-7 grid place-items-center rounded-full border transition ${
          pinned
            ? 'bg-live text-white border-white/20'
            : 'bg-black/60 text-white/80 border-white/20 group-hover:bg-black/80 group-hover:text-white'
        }`}
      >
        <IconPin className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

function PlayableCard({ channel, pinned, onTogglePin }) {
  const href = liveCardHref(channel);
  const hasViewers = channel.viewerCount != null && Number(channel.viewerCount) > 0;
  return (
    <div className="relative">
      <PinButton pinned={pinned} onTogglePin={onTogglePin} channel={channel} className="absolute top-0 right-0" />
      <Link
      to={href || '/'}
      state={liveCardState(channel)}
      data-testid="live-card"
      data-source={channel.source}
      className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition cursor-pointer"
    >
      <div className="relative aspect-video bg-canvas">
        <img
          src={channel.thumbnailUrl}
          alt={channel.title || `${channel.channelName} live`}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
          LIVE
        </span>
        {hasViewers && (
          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded num">{fmtViewers(channel.viewerCount)}</span>
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

export default function LiveCard({ channel, pinned, onTogglePin }) {
  return <PlayableCard channel={channel} pinned={pinned} onTogglePin={onTogglePin} />;
}
