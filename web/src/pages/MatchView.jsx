import { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeFootballFeed, normalizeChannel } from '../lib/live.js';
import { useApi } from '../hooks/useApi.js';
import LiveCard from '../components/LiveCard.jsx';

// ---------------------------------------------------------------------------
// Football match detail view (Task C) — opened from a football score card in the
// "Live now" grid. Deep-linkable at /match/:fixtureId.
//
//   • If the card passed router `state`, we render it immediately (no flash); we
//     still (re)fetch the football feed to get the CURRENT score/minute and to
//     support a bare deep-link with no state.
//   • Elapsed refresh: the feed is re-fetched every 60s so the clock/score advance.
//   • Bet CTAs (Home / Draw / Away): if a real market already exists for this
//     fixture we link straight to it; otherwise we open the Create flow prefilled
//     with a genuine question derived from the team names — never a fake market.
//   • "Find this match live": calls the keyless /api/search and shows ONLY real
//     playable results. No results → an honest text-first note (never a fake thumb).
//
// Honesty (§4): no fabricated art, no invented viewer counts, no simulated chat.
// ---------------------------------------------------------------------------

function matchClock(m) {
  if (!m) return { label: '', live: false };
  const st = m.status;
  if (st === 'HT') return { label: 'Half time', live: true };
  if (st === 'FT' || m.minute === 'FT') return { label: 'Full time', live: false };
  if (Number.isFinite(m.minute)) return { label: `Live · ${m.minute}'`, live: st === '1H' || st === '2H' };
  if (st) return { label: String(st), live: false };
  return { label: 'Scheduled', live: false };
}

// A deterministic set of initials derived from the team name — used in place of a
// club badge we don't have. It is text, not fabricated artwork (§4).
function initials(name) {
  const words = String(name || '').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

// A real, human question for the chosen outcome — prefills the Create flow.
function outcomeQuestion(home, away, pick) {
  if (pick === 'home') return `Will ${home} beat ${away}?`;
  if (pick === 'away') return `Will ${away} beat ${home}?`;
  return `Will ${home} vs ${away} end in a draw?`;
}

// Does a live room already carry a market about this fixture? Match on either team
// name appearing in the room title / hero question (case-insensitive). Purely a
// lookup over REAL rooms — we never conjure one when it's absent.
function findFixtureMarket(rooms, match) {
  if (!rooms || !match) return null;
  const hay = (s) => String(s || '').toLowerCase();
  const home = hay(match.home);
  const away = hay(match.away);
  return (
    rooms.find((r) => {
      const t = hay(r.title) + ' ' + hay(r.heroMarket?.question);
      return (home && t.includes(home)) || (away && t.includes(away));
    }) || null
  );
}

export default function MatchView() {
  const { fixtureId } = useParams();
  const location = useLocation();
  const navMatch = location.state && location.state.match ? location.state.match : null;

  const [match, setMatch] = useState(navMatch);
  const [hasFetched, setHasFetched] = useState(false);
  const [tick, setTick] = useState(0);

  const { data: rooms } = useApi(() => api.listRooms(), []);

  // (Re)fetch the football feed on mount, on deep-link id change, and every 60s.
  useEffect(() => {
    let cancelled = false;
    api
      .getLiveFootball(100)
      .then((raw) => {
        if (cancelled) return;
        const feed = normalizeFootballFeed(raw);
        const hit = feed.items.find((m) => m.id === fixtureId) || null;
        if (hit) setMatch(hit); // keep navMatch if the feed rotated away
        setHasFetched(true);
      })
      .catch(() => {
        if (!cancelled) setHasFetched(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureId, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // "Find this match live" — real /api/search results only.
  const [liveQuery, setLiveQuery] = useState(null); // null = not yet requested
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveResults, setLiveResults] = useState([]);

  function findLive() {
    if (!match) return;
    const q = `${match.home} vs ${match.away}`;
    setLiveQuery(q);
    setLiveLoading(true);
    api
      .search(q)
      .then((r) => {
        const items = (r.items || []).map(normalizeChannel).filter(Boolean);
        setLiveResults(items.filter((c) => c.source !== 'football-api' && c.thumbnailUrl));
      })
      .catch(() => setLiveResults([]))
      .finally(() => setLiveLoading(false));
  }

  const notFound = hasFetched && !match;
  const clock = matchClock(match);
  const leagueLine = match ? [match.league, match.country].filter(Boolean).join(' \u2022 ') : 'Football';
  const hasScore = match?.score && (match.score.home != null || match.score.away != null);
  const existingMarket = findFixtureMarket(rooms, match);

  const betHref = (pick) =>
    existingMarket
      ? `/room/${existingMarket.id}`
      : `/creator?title=${encodeURIComponent(outcomeQuestion(match.home, match.away, pick))}`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20">
      <Link to="/" className="text-xs text-white/50 hover:text-white/80 transition">
        ← Back to Live now
      </Link>

      {notFound ? (
        <div className="mt-6 rounded-card border border-dashed border-white/15 bg-surface/50 px-5 py-10 text-center">
          <p className="text-sm text-white/70">This match isn&apos;t in the live feed right now.</p>
          <p className="text-xs text-white/45 mt-1">Fixtures drop off shortly after full time. Try the Live now grid for current games.</p>
        </div>
      ) : !match ? (
        <div className="mt-6 animate-pulse text-sm text-white/50" data-testid="match-loading">
          Loading match…
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mt-3 text-xs text-white/50">
            <span className="truncate">{leagueLine || 'Football'}</span>
            {clock.label && (
              <span
                className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${
                  clock.live ? 'bg-red-600 text-white' : 'bg-white/10 text-white/70'
                }`}
              >
                {clock.live && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                {clock.label}
              </span>
            )}
          </div>

          {/* Scoreboard: name + derived initials badge (no fabricated crest). */}
          <div className="mt-4 bg-surface border border-white/10 rounded-card p-6">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center font-heading font-bold text-lg">
                  {initials(match.home)}
                </span>
                <span className="font-heading font-bold text-sm leading-tight line-clamp-2">{match.home}</span>
              </div>
              <span className="num text-4xl font-bold whitespace-nowrap" data-testid="match-score">
                {hasScore ? `${match.score.home} \u2013 ${match.score.away}` : 'vs'}
              </span>
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center font-heading font-bold text-lg">
                  {initials(match.away)}
                </span>
                <span className="font-heading font-bold text-sm leading-tight line-clamp-2">{match.away}</span>
              </div>
            </div>
            <p className="text-center text-[11px] text-white/40 mt-4">Scores refresh automatically every 60s.</p>
          </div>

          {/* Bet CTAs */}
          <div className="mt-5">
            <h2 className="font-heading font-bold text-base">Bet on this match</h2>
            {existingMarket ? (
              <p className="text-xs text-white/50 mt-1">
                A market already exists for this fixture — open it to trade.
              </p>
            ) : (
              <p className="text-xs text-white/50 mt-1">
                No market yet — pick an outcome to start one, prefilled with the question below.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {[
                { key: 'home', label: `Bet: ${match.home}` },
                { key: 'draw', label: 'Bet: Draw' },
                { key: 'away', label: `Bet: ${match.away}` },
              ].map((o) => (
                <Link
                  key={o.key}
                  to={betHref(o.key)}
                  state={existingMarket ? undefined : { prefillTitle: outcomeQuestion(match.home, match.away, o.key) }}
                  data-testid={`bet-${o.key}`}
                  className="block text-center rounded-card border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-3 text-sm font-semibold transition cursor-pointer"
                >
                  {o.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Find this match live */}
          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading font-bold text-base">Find this match live</h2>
              <button
                type="button"
                onClick={findLive}
                disabled={liveLoading}
                className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 bg-live/20 text-live hover:bg-live/30 transition disabled:opacity-50"
              >
                {liveLoading ? 'Searching…' : 'Search broadcasts'}
              </button>
            </div>

            {liveQuery && !liveLoading && (
              liveResults.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-3" data-testid="match-live-results">
                  {liveResults.slice(0, 6).map((c) => (
                    <LiveCard key={c.id} channel={c} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/50 mt-3" data-testid="match-live-empty">
                  No live broadcast of “{liveQuery}” is playing in our grid right now. We only list real,
                  playable streams — there&apos;s nothing to show rather than a made-up one.
                </p>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
