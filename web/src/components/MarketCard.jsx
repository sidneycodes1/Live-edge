import { Link } from 'react-router-dom';
import OddsBar from './OddsBar.jsx';

export default function MarketCard({ room }) {
  const hero = room.heroMarket;
  return (
    <Link to={`/room/${room.id}`} className="block bg-surface rounded-card border border-white/10 p-4 hover:border-white/20 transition">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 bg-live rounded-full animate-pulse" />
        <span className="text-white/70">LIVE</span>
        <span className="ml-auto text-white/50">{room.viewers} viewers</span>
        {room.isSeed && <span className="ml-2 px-2 py-0.5 bg-white/10 rounded-full text-[10px]">sample</span>}
      </div>
      <h3 className="font-heading font-bold mt-2 line-clamp-2">{room.title}</h3>
      <p className="text-xs text-white/60 mt-1">{room.owner?.displayName}</p>
      {hero && (
        <div className="mt-3">
          <p className="text-sm mb-2 line-clamp-2">{hero.question}</p>
          <OddsBar yesPrice={hero.yesPrice} noPrice={hero.noPrice} />
        </div>
      )}
    </Link>
  );
}
