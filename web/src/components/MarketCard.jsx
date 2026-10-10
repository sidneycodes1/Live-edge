import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import OddsBar from './OddsBar.jsx';
import MoneyChip from './MoneyChip.jsx';
import MarketSourceChip from './MarketSourceChip.jsx';
import PoweredByPanta from './PoweredByPanta.jsx';
import { countdownPill, startCountdownTick } from '../lib/countdown.js';
import { marketThumb } from '../lib/live-now.js';
import { tileGradient } from '../lib/landing.js';

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
// when there is no real visual it renders the SAME deterministic gradient header the
// landing tiles use (a hash of the bound channel / room id → a stable, decorative
// gradient + the market's REAL initial) — never a fabricated placeholder image (§4).
// Markets are not broadcasts, so there is no LIVE badge and no viewer count here.
// The countdown is clamped (see fmtTimeLeft) so a bad seed can never render
// "38522164m". s9: this card now shares the landing tile's visual shell so rails
// and grids read as one family.
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

  // s9 gradient-header fallback: seed it from the room's REAL binding (its Kick
  // channel when there is one, else its id) so the gradient is stable per market
  // across renders/visits — the exact rule landing.js documents for live tiles.
  const tileKey = String(room.kick_channel || room.id || '');
  const initial = String(headline || '').trim().slice(0, 1).toUpperCase();

  return (
    <Link
      to={`/room/${room.id}`}
      data-testid="market-card"
      className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition cursor-pointer"
    >
      {/* Media header — the SAME presence a landing tile has. Real thumbnail when
          one exists; otherwise the deterministic gradient + real initial. */}
      <div
        className="relative aspect-video overflow-hidden"
        style={thumb ? undefined : { backgroundImage: tileGradient(tileKey) }}
        data-testid="market-card-media"
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          initial && (
            <span
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center font-heading font-bold text-6xl text-white/85 drop-shadow-lg select-none"
            >
              {initial}
            </span>
          )
        )}
        {/* Category chip — landing-tile styling, only when the row really has one. */}
        {hero?.category && (
          <span className="absolute top-2 left-2 z-10 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-live/20 text-live">
            {hero.category}
          </span>
        )}
        {showPill && (
          <span className="absolute bottom-2 right-2 z-10 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded num" data-testid="market-card-countdown">
            {"\u23F3"} {countdown}
          </span>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Honesty label: where this price came from (Live·Panta / Stale / Simulated). */}
          {hero && <MarketSourceChip priceSource={hero.price_source} observedAt={hero.price_observed_at} className="ml-auto shrink-0" />}
        </div>
        <h3 className="font-heading font-bold text-[15px] leading-snug line-clamp-2">{headline}</h3>

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
          {/* Mandatory attribution on every Panta-sourced surface (ToU §6). */}
          {hero?.source === 'panta' && <PoweredByPanta className="ml-auto" />}
        </div>
      </div>
    </Link>
  );
}

