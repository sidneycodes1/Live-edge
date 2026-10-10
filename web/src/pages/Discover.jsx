import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeLive, normalizeChannel } from '../lib/live.js';
import { marketThumb } from '../lib/live-now.js';
import { mergePinnedFirst, MAX_PINS } from '../lib/pins.js';
import { tailorByInterests } from '../lib/tailoring.js';
import { consumeTunedNote } from '../lib/welcome.js';
import { usePins } from '../hooks/usePins.js';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { countdownPill } from '../lib/countdown.js';
import {
  groupKickByBucket, pickTopKickChannel, ladderLabel, tileGradient, channelInitial,
  orderLandingRows,
} from '../lib/landing.js';
import MarketCard from '../components/MarketCard.jsx';
import CategorySection from '../components/CategorySection.jsx';
import KickVideo from '../components/KickVideo.jsx';
import { liveCardHref, liveCardState } from '../components/LiveCard.jsx';
import Rail from '../components/Rail.jsx';
import OddsBar from '../components/OddsBar.jsx';
import MoneyChip from '../components/MoneyChip.jsx';
import MarketSourceChip from '../components/MarketSourceChip.jsx';
import PoweredByPanta from '../components/PoweredByPanta.jsx';
import Skeleton from '../components/Skeleton.jsx';
import WakeServer from '../components/WakeServer.jsx';
import { IconClock, IconTrending } from '../components/Icons.jsx';

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

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

// s4 honesty line shown above any section the server filled via the YouTube
// fallback — the rows are real, but they are NOT Kick and must never read as
// such (each tile also carries its own "via YouTube" chip).
const FALLBACK_NOTE = 'No live Kick streams here right now — showing real live streams from YouTube.';

// Kick-first category landing (docs/BUILD_CONTRACT-browse-ui-chat.md §4/§5) +
// the s4 empty-section fallback: a hero featured Kick box + four sections.
// The DEFAULT view comes pre-bucketed from GET /api/live/sections — Kick rows
// fill each bucket, and a bucket with ZERO Kick rows carries real YouTube live
// rows labelled "via YouTube" (server routes/sections.js; web never re-derives
// a bucket). An ACTIVE SEARCH still narrows the flat Kick grid client-side.
// Every tile is the honest placeholder (Kick exposes no thumbnails), every
// empty section shows an honest empty state, and nothing is backfilled from
// another bucket.
export default function Discover() {
  const [rooms, setRooms] = useState(null);
  const [live, setLive] = useState(null);
  // Server-bucketed landing sections ({ items, fallbackUsed, servedFrom }).
  const [sections, setSections] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [reload, setReload] = useState(0);
  const [params] = useSearchParams();
  const location = useLocation();
  const railRef = useRef(null);
  // Captured once per visit; drives the rotating category priority.
  const [seed] = useState(nextVisitSeed);
  // The user's pinned streams (server shelf, max 4) — they LEAD the section
  // their bucket falls into (mergePinnedFirst runs before the bucket split).
  const { pins, pinnedIds, toggle } = usePins();
  const [pinNote, setPinNote] = useState(null);
  // Interest tailoring reads the SIGNED-IN user's stored interests only
  // (docs/PRIVY_AUTH_SPEC.md "Tailoring rule"): logged-out browsing keeps the
  // current order — nothing is guessed from cookies/history (honesty §4).
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  // "Tuned for {name}" one-shot, written by the /welcome cover after a real
  // setup save; consumeTunedNote clears it, so it shows exactly once.
  const [tunedName] = useState(() => consumeTunedNote(window.sessionStorage));

  // Honest refusal when the 4 slots are full: say so, then fade the note.
  // The login refusal carries the sign-in OVERLAY trigger (Oct 2026) — the
  // note is a node there, plain text everywhere else.
  function handlePin(card) {
    return toggle(card).then((res) => {
      if (res.ok) setPinNote(null);
      else if (res.reason === 'limit') setPinNote(`You can pin up to ${MAX_PINS} streams — unpin one to make room.`);
      else if (res.reason === 'login') setPinNote(
        <span>
          Sign in to pin — your shelf follows your account, not this browser.{' '}
          <button type="button" onClick={openAuth} data-testid="pin-sign-in" className="underline font-bold cursor-pointer">Sign in</button>
        </span>
      );
      return res;
    });
  }
  useEffect(() => {
    if (!pinNote) return;
    const t = setTimeout(() => setPinNote(null), 4000);
    return () => clearTimeout(t);
  }, [pinNote]);

  // Search is server-side and keyless (/api/search). An active query narrows
  // the SAME landing sections to the matching rows (never a dead bar, never a
  // fabricated hit — the server only returns real matches).
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
    // Settle BOTH live sources before clearing the skeleton so the sections flip
    // to content (or their honest empty states) once, never in two jumpy passes.
    // The grid asks for MORE rows than the old rail (48): each section can
    // expand to 9 across three Kick buckets, so the fetched pool needs depth.
    Promise.allSettled([
      api.listRooms().then((r) => { if (!cancelled) setRooms(r); }),
      api.getLive(48).then((r) => { if (!cancelled) setLive(normalizeLive(r)); }),
      // s4: the four landing sections, bucketed + YouTube-filled SERVER-side
      // (never 500s; a failed fallback simply arrives as an empty bucket).
      api.getLiveSections(9).then((r) => {
        if (cancelled) return;
        setSections({
          items: Object.fromEntries(Object.entries(r?.items || {}).map(([k, v]) => [k, (v || []).map(normalizeChannel).filter(Boolean)])),
          fallbackUsed: r?.fallbackUsed || {},
          servedFrom: r?.servedFrom || 'empty',
        });
      }).catch(() => { if (!cancelled) setSections(null); }),
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
          count: r.count || 0,
        });
      })
      .catch(() => { if (!cancelled) setSearchView({ items: [], count: 0 }); })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  // Deep CTA from the congrats screen: focus the FIRST real card so keyboard and
  // screen-reader users land inside the feed ("Make your first prediction").
  // (Declared before the early returns below — hooks must keep a stable order.)
  useEffect(() => {
    if (!location.state?.focusFirstCard || loading) return;
    const el = railRef.current?.querySelector('a');
    if (el) el.focus({ preventScroll: false });
  }, [loading, location.state]);

  const all = rooms || [];

  // The landing rows. A search narrows the flat Kick grid client-side (exact
  // query, no pins/tailoring). Otherwise the server-bucketed s4 sections drive
  // the grids (until they arrive, the flat Kick grid fills the buckets with NO
  // cross-provider backfill — the skeleton-adjacent bridge is kick-only). The
  // per-section order law is unchanged: PINS FIRST → interest tailoring —
  // both only re-order real rows, never filter, never fabricate.
  let buckets;
  let laidKick = [];
  if (q) {
    laidKick = (searchView?.items || []).filter((c) => c.source === 'kick');
    buckets = groupKickByBucket(laidKick);
  } else if (sections) {
    const interests = user?.interests || [];
    buckets = Object.fromEntries(
      ['sports', 'news', 'irl', 'games'].map((k) => [k, orderLandingRows(sections.items?.[k] || [], pins, interests)]),
    );
    laidKick = buckets.sports; // hero = the top SPORTS row (server orders by real viewers)
  } else {
    const kickRows = (live?.items || []).filter((c) => c.source === 'kick');
    laidKick = tailorByInterests(mergePinnedFirst(kickRows, pins), user?.interests || [], {
      leadCount: pins.length,
    });
    buckets = groupKickByBucket(laidKick);
  }
  // Hero = the top Kick row by REAL viewerCount (all-null counts → first row,
  // and its panel simply renders no number — never a fake one).
  const hero = pickTopKickChannel(laidKick);
  // Never-empty ladder honesty (§1): a stale/floor grid keeps its label.
  const ladder = q ? null : ladderLabel(live?.servedFrom);
  // Keep the seed referenced where it still matters: the section order itself
  // is FIXED by the contract (§4 table), so the rotation seed now only drives
  // the legacy Live-now composition helpers; nothing reshuffles on reload.
  void seed;

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

  const sectionsLoading = q ? searchLoading : liveLoading;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <div ref={railRef}>
        {(pinNote || tunedName) && (
          <p className="text-xs text-live/90 mb-2" data-testid="landing-note">{pinNote || `Tuned for ${tunedName}`}</p>
        )}
        {q && (
          <p className="text-xs text-white/50 mb-2" data-testid="landing-search-context">
            Live results for “{params.get('q')}”
          </p>
        )}

        {/* ① HERO — the top Kick stream: real player embed + honest info panel */}
        {hero && (
          <section className="mt-2 grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch" data-testid="hero-kick">
            <div className="min-w-0">
              <KickVideo channel={hero.channelSlug} />
            </div>
            <div className="rounded-card border border-white/10 bg-surface p-5 flex flex-col gap-3 min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                {/* Avatar: deterministic gradient + REAL initial — never invented art. */}
                <span
                  aria-hidden="true"
                  className="w-11 h-11 shrink-0 rounded-full grid place-items-center font-heading font-bold text-lg text-white/90 border border-white/15"
                  style={{ backgroundImage: tileGradient(hero.channelSlug) }}
                >
                  {channelInitial(hero)}
                </span>
                <div className="min-w-0">
                  <h2 className="font-heading font-bold text-lg leading-tight truncate">{hero.channelName || hero.channelSlug || 'Live on Kick'}</h2>
                  <p className="text-xs text-white/55 truncate mt-0.5">{hero.title || 'Live stream'}</p>
                </div>
              </div>
              {/* Real viewer count ONLY when the provider exposed one (§1). */}
              {hero.viewerCount != null && (
                <p className="text-sm text-white/70" data-testid="hero-viewers">
                  <span className="num font-semibold">{fmtViewers(hero.viewerCount)}</span> watching now
                </p>
              )}
              {/* Tags: only fields the row actually carries. */}
              {(hero.category || (hero.bucket && hero.bucket !== 'other')) && (
                <div className="flex flex-wrap gap-1.5" data-testid="hero-tags">
                  {hero.category && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-live/20 text-live">{hero.category}</span>
                  )}
                  {hero.bucket && hero.bucket !== 'other' && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-white/10 text-white/70">{hero.bucket}</span>
                  )}
                </div>
              )}
              <Link
                to={liveCardHref(hero) || '/'}
                state={liveCardState(hero)}
                data-testid="hero-watch-link"
                className="mt-auto text-sm font-semibold text-live hover:underline cursor-pointer"
              >
                Watch on LiveEdge →
              </Link>
            </div>
          </section>
        )}

        {/* Honest ladder rung (stale/floor never presented as fresh, §1). */}
        {ladder && <p className="text-xs text-white/55 mt-4" data-testid="live-ladder-note">{ladder}</p>}

        {/* ② CATEGORY SECTIONS — the four landing buckets (§4), 3-col grids.
            s4: when the server filled a section via the YouTube fallback, the
            section says so honestly above the grid. */}
        <CategorySection
          title="Sports"
          sectionKey="sports"
          items={buckets.sports}
          loading={sectionsLoading}
          testid="section-sports"
          pinnedIds={pinnedIds}
          onTogglePin={handlePin}
          fallbackNote={!q && sections?.fallbackUsed?.sports ? FALLBACK_NOTE : null}
        />
        <CategorySection
          title="News"
          sectionKey="news"
          items={buckets.news}
          loading={sectionsLoading}
          pinnedIds={pinnedIds}
          onTogglePin={handlePin}
          fallbackNote={!q && sections?.fallbackUsed?.news ? FALLBACK_NOTE : null}
        />
        <CategorySection
          title="IRL"
          sectionKey="irl"
          items={buckets.irl}
          loading={sectionsLoading}
          pinnedIds={pinnedIds}
          onTogglePin={handlePin}
          fallbackNote={!q && sections?.fallbackUsed?.irl ? FALLBACK_NOTE : null}
        />
        <CategorySection
          title="Games"
          sectionKey="games"
          items={buckets.games}
          loading={sectionsLoading}
          pinnedIds={pinnedIds}
          onTogglePin={handlePin}
          fallbackNote={!q && sections?.fallbackUsed?.games ? FALLBACK_NOTE : null}
        />
      </div>

      {/* ③ FEATURED LIVE — one hero market (real thumbnail only, else text-first) */}
      {featured && (
        <Link
          to={`/room/${featured.id}`}
          data-testid="featured-hero"
          className="group block mt-8 rounded-card overflow-hidden border border-white/10 bg-surface hover:border-white/25 transition cursor-pointer"
        >
          <div className={`grid ${featuredThumb ? 'md:grid-cols-2' : ''}`}>
            <div className="order-2 md:order-1 p-5 flex flex-col justify-center">
              <span className="text-[11px] uppercase tracking-wide text-live font-bold">Featured · live now</span>
              <div className="flex items-center gap-2 mt-1.5">
                <h3 className="font-heading font-bold text-2xl leading-tight line-clamp-3">{featured.heroMarket.question}</h3>
                <MarketSourceChip priceSource={featured.heroMarket.price_source} observedAt={featured.heroMarket.price_observed_at} className="shrink-0" />
              </div>
              <div className="mt-4"><OddsBar yesPrice={featured.heroMarket.yesPrice} noPrice={featured.heroMarket.noPrice} /></div>
              <div className="flex items-center gap-3 mt-3 text-xs text-white/55">
                <MoneyChip />
                <span className="num">{Math.round((featured.heroMarket.volume || 0) / 10)} betting</span>
                <span className="truncate">{featured.owner?.displayName}</span>
                {featured.heroMarket.source === 'panta' && <PoweredByPanta className="ml-auto" />}
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

      {/* ④ TRENDING BETS */}
      <Rail title="Trending bets" icon={<IconTrending className="w-5 h-5" />} rooms={trending} testid="rail-trending" />

      {/* ⑤ CLOSING SOON */}
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
