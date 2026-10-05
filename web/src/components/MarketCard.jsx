import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import OddsBar from './OddsBar.jsx';
import MoneyChip from './MoneyChip.jsx';
import { countdownPill, startCountdownTick } from '../lib/countdown.js';
import { marketThumb } from '../lib/live-now.js';

// Re-render once per second while a countdown pill is on screen, so the timer
// actually TICKS (see lib/countdown.js — the heartbeat itself is unit-tested).
function useCountdownTick(active) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    return startCountdownTick(() => setN((n) => n + 1));
  }, [active]);
}

// A Discover market tile. It leads with the BET (question + odds + social proof).
// The image is the REAL thumbnail of the underlying stream when one exists (its own
// provider image, or a genuine YouTube thumb derived from the market's video id);
// when there is no real visual it renders a clean TEXT-FIRST card — never a
// fabricated placeholder (§4). Markets are not broadcasts, so there is no LIVE badge
// and no viewer count here. The countdown is clamped (see fmtTimeLeft) so a bad seed
// can never render "38522164m".
export default function MarketCard({ room }) {
  const hero = room.heroMarket;
  const headline = hero?.question || room.title;
  // The room/stream this market belongs to. Shown as its own context line when the
  // headline is the bet question (so the reader still sees WHICH stream it's on).
  const streamName = room.title;
  const showStream = Boolean(hero?.question && streamName && streamName !== headline);
  const betting = hero ? Math.max(0, Math.round((hero.volume || 0) / 10)) : 0;
  const countdown = countdownPill(hero);
  const thumb = marketThumb(room);
  const showPill = Boolean(countdown);
  useCountdownTick(showPill);

  return (
    <Link
      to={`/room/${room.id}`}
      data-testid="market-card"
      className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition"
    >
      {thumb && (
        <div className="relative aspect-video bg-black">
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
      )}
      <div className="p-3">
        {hero?.category && (
          <span className="text-[10px] uppercase tracking-wide text-white/45">{hero.category}</span>
        )}
        <h3 className="font-heading font-bold text-[15px] leading-snug line-clamp-2 mt-0.5">{headline}</h3>

        {showStream && (
          <p className="flex items-center gap-1 mt-1 text-[11px] text-white/50 min-w-0" data-testid="market-stream">
            <span className="shrink-0 uppercase tracking-wide text-white/35">in</span>
            <span className="truncate">{streamName}</span>
          </p>
        )}

        {hero && (
          <div className="mt-2">
            <OddsBar yesPrice={hero.yesPrice} noPrice={hero.noPrice} />
          </div>
        )}

        <div className="flex items-center gap-2 mt-2.5 text-xs text-white/55 min-w-0">
          <span className="w-5 h-5 shrink-0 rounded-full bg-white/10 text-white/70 flex items-center justify-center text-[10px] font-bold">
            {(room.owner?.displayName || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate">{room.owner?.displayName || 'LiveEdge'}</span>
        </div>

        <div className="flex items-center gap-2 mt-2 text-[11px] text-white/45">
          <MoneyChip />
          {hero && <span className="num">{betting} betting</span>}
          {showPill && <span className="ml-auto num whitespace-nowrap text-live/80">{"\u23F3"} {countdown}</span>}
        </div>
      </div>
    </Link>
  );
}
