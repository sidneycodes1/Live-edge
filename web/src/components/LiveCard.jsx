import { Link } from 'react-router-dom';

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
//      the visual). No image area, no viewer count. No link (there is no watchable
//      route for a bare fixture — we never create a dead link).
//
// No "no preview" tiles, no equalizers, no placeholder art anywhere.
// ---------------------------------------------------------------------------

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

// Where a card links. Football fixtures have no watchable route → null (no dead
// link). Twitch keeps its dedicated surface; everything else the generic watch.
export function liveCardHref(ch) {
  if (!ch || ch.source === 'football-api') return null;
  if (ch.source === 'twitch' && ch.channelSlug) return `/twitch/${encodeURIComponent(ch.channelSlug)}`;
  const slug = ch.channelSlug || ch.id;
  return `/watch/${encodeURIComponent(ch.source || 'live')}/${encodeURIComponent(slug)}`;
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

function PlayableCard({ channel }) {
  const href = liveCardHref(channel);
  const hasViewers = channel.viewerCount != null && Number(channel.viewerCount) > 0;
  return (
    <Link
      to={href || '/'}
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
  );
}

function FootballScoreCard({ match }) {
  const clock = matchClock(match);
  const leagueLine = [match.league, match.country].filter(Boolean).join(' \u2022 ');
  const hasScore = match.score && (match.score.home != null || match.score.away != null);
  return (
    <div
      data-testid="card-match"
      data-source="football-api"
      className="block bg-surface rounded-card border border-white/10 overflow-hidden"
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
        <p className="text-[11px] text-white/45 truncate">{match.title}</p>
      </div>
    </div>
  );
}

export default function LiveCard({ channel }) {
  if (channel.source === 'football-api') return <FootballScoreCard match={channel} />;
  return <PlayableCard channel={channel} />;
}
