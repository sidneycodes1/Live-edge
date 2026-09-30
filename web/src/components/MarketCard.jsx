import { Link } from 'react-router-dom';
import OddsBar from './OddsBar.jsx';
import LiveThumb from './LiveThumb.jsx';
import MoneyChip from './MoneyChip.jsx';
import { fmtTimeLeft } from '../lib/format.js';

// A Discover tile now leads with the BET, not the stream: the market question is the
// headline (room.title is demoted), set over a live 16:9 preview frame with odds and
// social proof. This is the core reframe of the streaming UI (plan Phase A).
export default function MarketCard({ room }) {
  const hero = room.heroMarket;
  const headline = hero?.question || room.title;

  // Social proof is derived from real market volume only — never fabricated (§1.3).
  // When a market has no activity we show the honest (zero) number.
  const betting = hero ? Math.max(0, Math.round((hero.volume || 0) / 10)) : 0;
  const countdown = hero && hero.status === 'open' && hero.end_time ? fmtTimeLeft(hero.end_time) : null;

  return (
    <Link
      to={`/room/${room.id}`}
      data-testid="market-card"
      className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition"
    >
      <LiveThumb imageUrl={hero?.image_url} title={headline} viewers={room.viewers} />
      <div className="p-3">
        <h3 className="font-heading font-bold text-[15px] leading-snug line-clamp-2">{headline}</h3>

        {hero && (
          <div className="mt-2">
            <OddsBar yesPrice={hero.yesPrice} noPrice={hero.noPrice} />
          </div>
        )}

        {/* streamer + category, deliberately quieter than the bet */}
        <div className="flex items-center gap-2 mt-2.5 text-xs text-white/55 min-w-0">
          <span className="w-5 h-5 shrink-0 rounded-full bg-white/10 text-white/70 flex items-center justify-center text-[10px] font-bold">
            {(room.owner?.displayName || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate">{room.owner?.displayName || 'LiveEdge'}</span>
          {hero?.category && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate capitalize">{hero.category}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 text-[11px] text-white/45">
          <MoneyChip />
          {hero && (
            <span className="ml-auto num whitespace-nowrap">
              {betting} betting
              {countdown && countdown !== 'closed' ? <span className="text-live/80"> · {countdown}</span> : null}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
