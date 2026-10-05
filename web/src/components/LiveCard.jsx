import { Link } from 'react-router-dom';
import { extractYouTubeVideoId, extractYouTubeChannelId } from '../lib/embed.js';
import { IconPin } from './Icons.jsx';

// ---------------------------------------------------------------------------
// The two — and ONLY two — honest card kinds for the "Live now" grid
// (docs/live-aggregation-spec.md §4 honesty):
//
//   1. Playable card  — a real broadcast: its OWN thumbnail, a LIVE badge, title,
//      channel and a category chip. A viewer count is shown ONLY when the provider
//      actually exposes one (curated 24/7 rows carry none → we render nothing,
//      never a fabricated 0). Clicking opens the in-app watch/embed view.
//   2. Football score card — a DATA fixture (source 'football-api'). There is no
//      broadcast art for a match, so the card is a clean data tile (the score IS
//      the visual). No image area, no viewer count. Clicking opens the deep-linkable
//      match detail view (/match/:fixtureId) — never a dead link.
//
// No "no preview" tiles, no equalizers, no placeholder art anywhere.
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
// id (they embed by channel, live_stream?channel=UC…). Football fixtures open the
// match detail route. Twitch keeps its dedicated surface.
export function liveCardHref(ch) {
  if (!ch) return null;
  if (ch.source === 'football-api') return `/match/${encodeURIComponent(ch.id || '')}`;
  if (ch.source === 'twitch' && ch.channelSlug) return `/twitch/${encodeURIComponent(ch.channelSlug)}`;
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
  if (!ch || ch.source === 'football-api') return undefined;
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

// A live-period label for a fixture, or null. minute may be a number, 'FT', or
// null. When there is no minute we render NOTHING (never a fake "0").
function matchClock(m) {
  const st = m.status;
  if (st === 'HT') return { label: 'HT', live: true };
  if (st === 'FT' || m.minute === 'FT') return { label: 'FT', live: false };
  if (Number.isFinite(m.minute)) return { label: `LIVE ${m.minute}'`, live: st === '1H' || st === '2H' };
  return null;
}

// Pin toggle — "I'm watching / playing with this stream": it leads the Live now
// grid (max 4, server-authoritative). Rendered OUTSIDE the <Link> so pressing it
// never navigates. Only appears once the caller wires onTogglePin up.
// Tap rule: the BUTTON box is 44×44 (effective hit-area) while the visible
// circle stays 28px, centred inside it — corner anchors below account for the
// 8px transparent padding so the visual lands exactly where it did before.
function PinButton({ pinned, onTogglePin, channel, className = '' }) {
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
      <div className="relative aspect-video bg-black">
        <img
          src={channel.thumbnailUrl}
          alt={channel.title || `${channel.channelName} live`}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
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

function FootballScoreCard({ channel, match, pinned, onTogglePin }) {
  const clock = matchClock(match);
  const leagueLine = [match.league, match.country].filter(Boolean).join(' \u2022 ');
  const hasScore = match.score && (match.score.home != null || match.score.away != null);
  return (
    <div className="relative">
      <PinButton pinned={pinned} onTogglePin={onTogglePin} channel={channel} className="absolute bottom-0 right-0" />
      <Link
      to={liveCardHref(match) || '/'}
      state={{ match }}
      data-testid="card-match"
      data-source="football-api"
      className="block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition cursor-pointer"
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 min-h-[18px]">
          <span className="text-[10px] uppercase tracking-wide text-white/45 truncate">{leagueLine || 'Football'}</span>
          {clock && (
            <span className="shrink-0 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              {clock.live && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
              {clock.label}
            </span>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-5">
          <span className="text-right font-heading font-bold text-sm leading-tight line-clamp-2">{match.home}</span>
          <span className="num text-2xl font-bold px-1 whitespace-nowrap">{hasScore ? `${match.score.home} \u2013 ${match.score.away}` : 'vs'}</span>
          <span className="text-left font-heading font-bold text-sm leading-tight line-clamp-2">{match.away}</span>
        </div>
        <p className={`text-[11px] text-white/45 truncate ${onTogglePin ? 'pr-8' : ''}`}>{match.title}</p>
      </div>
      </Link>
    </div>
  );
}

export default function LiveCard({ channel, pinned, onTogglePin }) {
  if (channel.source === 'football-api') return <FootballScoreCard channel={channel} match={channel} pinned={pinned} onTogglePin={onTogglePin} />;
  return <PlayableCard channel={channel} pinned={pinned} onTogglePin={onTogglePin} />;
}
