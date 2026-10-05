import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeLive, normalizeChannel, normalizeMatch, normalizeFootballFeed } from '../lib/live.js';
import { buildLiveNowCards, marketThumb } from '../lib/live-now.js';
import { mergePinnedFirst, MAX_PINS } from '../lib/pins.js';
import { usePins } from '../hooks/usePins.js';
import { countdownPill } from '../lib/countdown.js';
import MarketCard from '../components/MarketCard.jsx';
import LiveNow from '../components/LiveNow.jsx';
import Rail from '../components/Rail.jsx';
import OddsBar from '../components/OddsBar.jsx';
import MoneyChip from '../components/MoneyChip.jsx';
import Skeleton from '../components/Skeleton.jsx';
import WakeServer from '../components/WakeServer.jsx';
import { IconFlame, IconClock, IconTrending } from '../components/Icons.jsx';

// Per-visit rotation seed. A sessionStorage COUNTER (never a permanent
// localStorage value) so consecutive visits cycle which category leads the
// "Live now" mix, while the value is captured ONCE into state below — keeping it
// stable across every re-render within the same visit (no mid-session reshuffle).
function nextVisitSeed() {
  let n = 0;
  try {
    const raw = Number(window.sessionStorage.getItem('liveedge_visit_seed'));
    n = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    window.sessionStorage.setItem('liveedge_visit_seed', String(n + 1));
  } catch {
    /* storage unavailable (private mode) → fall back to a time-derived seed */
    n = Math.floor(Date.now() / 3_600_000);
  }
  return n;
}

// A playable live row is one that carries a REAL thumbnail (curated 24/7, Twitch,
// Kick, YouTube all do). Anything without art is dropped from the grid — we never
// render a placeholder tile. Football score cards come from a SEPARATE data feed.
const isPlayable = (c) => Boolean(c && c.source !== 'football-api' && c.thumbnailUrl);

export default function Discover() {
  const [rooms, setRooms] = useState(null);
  const [live, setLive] = useState(null);
  const [football, setFootball] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [reload, setReload] = useState(0);
  const [params] = useSearchParams();
  // Captured once per visit; drives the rotating category priority.
  const [seed] = useState(nextVisitSeed);
  // The user's pinned streams (server shelf, max 4) — they LEAD the default grid.
  const { pins, pinnedIds, toggle } = usePins();
  const [pinNote, setPinNote] = useState(null);

  // Honest refusal when the 4 slots are full: say so, then fade the note.
  function handlePin(card) {
    return toggle(card).then((res) => {
      if (res.ok) setPinNote(null);
      else if (res.reason === 'limit') setPinNote(`You can pin up to ${MAX_PINS} streams — unpin one to make room.`);
      return res;
    });
  }
  useEffect(() => {
    if (!pinNote) return;
    const t = setTimeout(() => setPinNote(null), 4000);
    return () => clearTimeout(t);
  }, [pinNote]);

  // Search is server-side and keyless (/api/search). The landing grid re-uses the
  // SAME "Live now" rail to show matches, so a query never looks like a dead bar.
  const q = (params.get('q') || '').trim().toLowerCase();
  const [searchView, setSearchView] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWaking(false);
    // If the first paint is still pending after 2.5s, surface the cold-start hint.
    // The timer is cleared the moment data settles, so it never needs to read
    // `loading` (which would churn this effect's dependency array).
    const t = setTimeout(() => { if (!cancelled) setWaking(true); }, 2500);
    // Settle BOTH live sources before clearing the skeleton so the rail flips to
    // content (or the honest empty state) once, never in two jumpy passes.
    Promise.allSettled([
      api.listRooms().then((r) => { if (!cancelled) setRooms(r); }),
      api.getLive(24).then((r) => { if (!cancelled) setLive(normalizeLive(r)); }),
      api.getLiveFootball(6).then((r) => { if (!cancelled) setFootball(normalizeFootballFeed(r)); }),
    ]).then(() => {
      if (cancelled) return;
      clearTimeout(t);
      setLoading(false);
      setLiveLoading(false);
    });
    return () => { cancelled = true; clearTimeout(t); };
  }, [reload]);

  // Live motion at the grid level: re-poll the cheap rooms list every 5s so card
  // odds drift on their own (OddsBar animates the change). Pauses when hidden.
  useEffect(() => {
    if (loading) return;
    let active = true;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      api.listRooms().then((r) => { if (active) setRooms(r); }).catch(() => {});
    };
    const id = setInterval(tick, 5000);
    return () => { active = false; clearInterval(id); };
  }, [loading]);

  // Query-driven search. Empty query clears the view (back to the default grid).
  useEffect(() => {
    if (!q) { setSearchView(null); setSearchLoading(false); return; }
    let cancelled = false;
    setSearchLoading(true);
    api.search(q)
      .then((r) => {
        if (cancelled) return;
        setSearchView({
          items: (r.items || []).map(normalizeChannel).filter(Boolean),
          football: (r.football || []).map(normalizeMatch).filter(Boolean),
          count: r.count || 0,
        });
      })
      .catch(() => { if (!cancelled) setSearchView({ items: [], football: [], count: 0 }); })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  const all = rooms || [];

  // The "Live now" cards: from search matches when a query is active, else the
  // default playable grid + football feed. Composed & rotated by seed. Pins only
  // lead the DEFAULT feed — a search shows exactly what was searched for.
  const playableSource = q ? (searchView?.items || []) : (live?.items || []);
  const footballSource = q ? (searchView?.football || []) : (football?.items || []);
  const baseCards = buildLiveNowCards(
    { playable: playableSource.filter(isPlayable), football: footballSource },
    seed,
  );
  const cards = q ? baseCards : mergePinnedFirst(baseCards, pins);
  // How many REAL playable streams made it into the rail. When this is 0 while
  // football scores remain, the grid has silently collapsed — LiveNow shows an
  // honest "streams are loading / retry" panel instead of a football-only wall (D).
  const playableCount = cards.reduce((n, c) => n + (c.source !== 'football-api' ? 1 : 0), 0);

  // Market rails re-present the SAME rooms through honest lenses (re-sorting,
  // never fabricating). When searching, narrow them to the matching query too.
  const searched = !q
    ? all
    : all.filter((r) => {
        const hay = [r.title, r.owner?.displayName, r.heroMarket?.question, r.heroMarket?.category]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
  const trending = [...searched].filter((r) => r.heroMarket).sort((a, b) => (b.heroMarket.volume || 0) - (a.heroMarket.volume || 0)).slice(0, 10);
  // "Closing soon" must only contain markets that ACTUALLY close soon: the same
  // countdownPill predicate the cards use (honesty clamp, open status), so a
  // card can never claim a slot in this rail without a ticking pill of its own.
  const closing = [...searched]
    .filter((r) => r.heroMarket && countdownPill(r.heroMarket))
    .sort((a, b) => new Date(a.heroMarket.end_time) - new Date(b.heroMarket.end_time))
    .slice(0, 10);
  const featured = trending.find((r) => r.heroMarket.status === 'open') || null;
  const featuredThumb = featured ? marketThumb(featured) : null;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        {waking && <WakeServer />}
        <div className="grid md:grid-cols-3 gap-4 mt-4">
          <Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  const livenowLoading = q ? searchLoading : liveLoading;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      {/* ① LIVE NOW — the mixed, rotating grid of real broadcasts + football scores */}
      <LiveNow
        cards={cards}
        loading={livenowLoading}
        playableCount={playableCount}
        onRetry={() => setReload((n) => n + 1)}
        icon={<IconFlame className="w-5 h-5" />}
        pinnedIds={pinnedIds}
        onTogglePin={handlePin}
        note={pinNote}
      />

      {/* ② FEATURED LIVE — one hero market (real thumbnail only, else text-first) */}
      {featured && (
        <Link
          to={`/room/${featured.id}`}
          data-testid="featured-hero"
          className="group block mt-8 rounded-card overflow-hidden border border-white/10 bg-surface hover:border-white/25 transition cursor-pointer"
        >
          <div className={`grid ${featuredThumb ? 'md:grid-cols-2' : ''}`}>
            <div className="order-2 md:order-1 p-5 flex flex-col justify-center">
              <span className="text-[11px] uppercase tracking-wide text-live font-bold">Featured · live now</span>
              <h3 className="font-heading font-bold text-2xl mt-1.5 leading-tight line-clamp-3">{featured.heroMarket.question}</h3>
              <div className="mt-4"><OddsBar yesPrice={featured.heroMarket.yesPrice} noPrice={featured.heroMarket.noPrice} /></div>
              <div className="flex items-center gap-3 mt-3 text-xs text-white/55">
                <MoneyChip />
                <span className="num">{Math.round((featured.heroMarket.volume || 0) / 10)} betting</span>
                <span className="truncate">{featured.owner?.displayName}</span>
              </div>
            </div>
            {featuredThumb && (
              <div className="order-1 md:order-2 relative aspect-video md:aspect-auto bg-black">
                <img
                  src={featuredThumb}
                  alt={featured.heroMarket.question}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
            )}
          </div>
        </Link>
      )}

      {/* ③ TRENDING BETS */}
      <Rail title="Trending bets" icon={<IconTrending className="w-5 h-5" />} rooms={trending} testid="rail-trending" />

      {/* ④ CLOSING SOON */}
      <Rail title="Closing soon" icon={<IconClock className="w-5 h-5" />} rooms={closing} testid="rail-closing" />

      {/* Market browse grid (the simulated markets), narrowed by an active query. */}
      {q ? (
        <div className="mt-8">
          <h2 className="font-heading font-bold text-lg text-white/80">Markets matching “{params.get('q')}”</h2>
          {searched.length === 0 ? (
            <p className="text-sm text-white/50 mt-2">No markets match your search.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3 min-w-0">
              {searched.map((r) => <MarketCard key={r.id} room={r} />)}
            </div>
          )}
        </div>
      ) : all.length > 0 && (
        <div className="mt-8">
          <h2 className="font-heading font-bold text-lg text-white/80">All markets</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3 min-w-0">
            {all.map((r) => <MarketCard key={r.id} room={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}
