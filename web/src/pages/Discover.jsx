import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import MarketCard from '../components/MarketCard.jsx';
import TwitchLiveCard from '../components/TwitchLiveCard.jsx';
import Rail from '../components/Rail.jsx';
import CategoryChips from '../components/CategoryChips.jsx';
import OddsBar from '../components/OddsBar.jsx';
import LiveThumb from '../components/LiveThumb.jsx';
import MoneyChip from '../components/MoneyChip.jsx';
import Skeleton from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import WakeServer from '../components/WakeServer.jsx';

export default function Discover() {
  const [rooms, setRooms] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [twitch, setTwitch] = useState({ status: 'loading', items: [], enabled: false });
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [params] = useSearchParams();
  const [cat, setCat] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (loading) setWaking(true); }, 2500);
    api.listRooms().then(r => { if (!cancelled) { setRooms(r); setLoading(false); } }).catch(() => { if (!cancelled) setLoading(false); });
    api.getCatalog().then(setCatalog).catch(() => {});
    // Independent of the simulated rooms: a slow/failing Twitch fetch must never
    // block or break the rest of Discover.
    api.listTwitchLive(12)
      .then(r => { if (!cancelled) setTwitch({ status: 'ready', items: r.items || [], enabled: Boolean(r.enabled) }); })
      .catch(() => { if (!cancelled) setTwitch({ status: 'error', items: [], enabled: false }); });
    return () => { cancelled = true; clearTimeout(t); };
  }, [loading]);

  // Live motion at the grid level (plan §1.1): re-poll the cheap rooms list every 5s
  // so card odds drift on their own. OddsBar detects the price change and animates.
  // Pauses when the tab is hidden to avoid needless background churn.
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

  // "Biggest movers" needs price history across polls. Track the last-seen YES price
  // per market in a ref and surface only rooms whose odds actually moved — honest
  // motion, never a fabricated number. Empty on first paint (nothing has moved yet).
  const prevPrices = useRef(new Map());
  const [movers, setMovers] = useState([]);
  useEffect(() => {
    if (!rooms) return;
    const scored = rooms.map((r) => {
      const hm = r.heroMarket;
      if (!hm || hm.yesPrice == null) return { r, delta: 0 };
      const prev = prevPrices.current.get(hm.id);
      const delta = prev == null ? 0 : hm.yesPrice - prev;
      prevPrices.current.set(hm.id, hm.yesPrice);
      return { r, delta };
    });
    setMovers(scored.filter((x) => Math.abs(x.delta) > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map((x) => x.r));
  }, [rooms]);

  const all = rooms || [];

  // "Live on Twitch" — a clearly-labeled REAL layer, distinct from the simulated
  // rooms below. Hidden entirely when disabled or empty/degraded so it never looks
  // broken (see feature spec §Phase B).
  const showTwitch = twitch.status === 'ready' && twitch.enabled && twitch.items.length > 0;

  // Client-side search from the top bar (?q=...). Matches the bet question, the
  // room/stream title, the owner, and the category.
  const q = (params.get('q') || '').trim().toLowerCase();
  const searched = !q
    ? all
    : all.filter((r) => {
        const hay = [r.title, r.owner?.displayName, r.heroMarket?.question, r.heroMarket?.category]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
  const gridRooms = cat ? searched.filter((r) => r.heroMarket?.category === cat) : searched;

  // Categories are derived from the live rooms only (no invented taxonomy).
  const categories = Array.from(new Set(all.map((r) => r.heroMarket?.category).filter(Boolean))).sort();

  // Rails re-present the same rooms through different lenses (abundance by
  // re-sorting, never fabrication).
  const trending = [...all].filter((r) => r.heroMarket).sort((a, b) => (b.heroMarket.volume || 0) - (a.heroMarket.volume || 0)).slice(0, 10);
  const closing = [...all]
    .filter((r) => r.heroMarket && r.heroMarket.status === 'open' && r.heroMarket.end_time)
    .sort((a, b) => new Date(a.heroMarket.end_time) - new Date(b.heroMarket.end_time))
    .slice(0, 10);
  const featured = trending.find((r) => r.heroMarket.status === 'open') || null;

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6">{waking && <WakeServer />}<div className="grid md:grid-cols-3 gap-4 mt-4"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      {showTwitch && (
        <section className="mb-8" data-testid="twitch-live-section">
          <div className="flex items-center gap-2">
            <h2 className="font-heading font-bold text-xl">Live on Twitch</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-live/20 text-live px-2 py-0.5 rounded-full">real</span>
          </div>
          <p className="text-xs text-white/40 mt-1">Currently-live channels from Twitch. Opens real video + chat alongside a simulated market.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            {twitch.items.map(s => <TwitchLiveCard key={s.id} stream={s} />)}
          </div>
        </section>
      )}

      {featured && (
        <Link to={`/room/${featured.id}`} data-testid="featured-hero" className="group block mt-2 rounded-card overflow-hidden border border-white/10 bg-surface hover:border-white/25 transition">
          <div className="grid md:grid-cols-2">
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
            <div className="order-1 md:order-2"><LiveThumb imageUrl={featured.heroMarket.image_url} title={featured.heroMarket.question} viewers={featured.viewers} /></div>
          </div>
        </Link>
      )}

      {categories.length > 0 && (
        <div className="mt-6">
          <CategoryChips categories={categories} active={cat} onSelect={setCat} />
        </div>
      )}

      <Rail title="🔥 Biggest movers" rooms={movers} testid="rail-movers" />
      <Rail title="⏳ Closing soon" rooms={closing} testid="rail-closing" />
      <Rail title="📈 Trending now" rooms={trending} testid="rail-trending" />

      {all.length === 0 ? (
        <EmptyState title="No live rooms yet" body="Be the first to create a room and drop a market." />
      ) : (
        <>
          <h2 className="font-heading font-bold text-lg mt-8 text-white/80">Live Rooms <span className="text-xs font-normal text-white/40">{q ? `(matching “${params.get('q')}”)` : '(your simulated markets)'}</span></h2>
          {gridRooms.length === 0
            ? <EmptyState title="No matches" body={`Nothing here matches ${q ? `“${params.get('q')}”` : 'this filter'}.`} />
            : (
              <div className="grid md:grid-cols-3 gap-4 mt-3">
                {gridRooms.map((r) => <MarketCard key={r.id} room={r} />)}
              </div>
            )}
        </>
      )}

      {catalog && catalog.items && catalog.items.length > 0 && (
        <div className="mt-8">
          <h2 className="font-heading font-bold">Real markets on Panta</h2>
          <p className="text-xs text-white/40">Read-only live catalog</p>
          <div className="flex gap-2 overflow-x-auto mt-2 pb-2">
            {catalog.items.slice(0, 6).map((m, i) => <div key={m.id || m.marketId || m.question || `cat-${i}`} className="min-w-[220px] bg-surface border border-white/10 rounded-card p-3 text-xs">{m.question || m.title || 'Market'}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
