import OddsBar from './OddsBar.jsx';
import MoneyChip from './MoneyChip.jsx';
import { IconClock } from './Icons.jsx';
import { fmtTimeLeft } from '../lib/format.js';

export default function MarketPanel({ market, onTrade }) {
  if (!market) return <div className="p-4 text-white/50">No market yet</div>;
  // Only show a countdown while genuinely open AND time remains — never the
  // literal "closed" on an open market (F-015).
  const timeLeft = market.status === 'open' ? fmtTimeLeft(market.end_time) : null;
  return (
    <div className="bg-surface rounded-card border border-white/10 p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className={`px-2 py-1 rounded-full text-xs ${market.status==='open'?'bg-live text-black':'bg-white/10'}`}>{market.status}</span>
        {timeLeft && timeLeft !== 'closed' && (
          <span data-testid="market-countdown" className="num inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/60"><IconClock className="w-3.5 h-3.5" /> {timeLeft}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {market.graduated && <span className="text-yes">graduated</span>}
          <MoneyChip />
        </span>
      </div>
      <h3 className="font-heading font-bold mt-3 text-lg">{market.question}</h3>
      <p className="text-xs text-white/60 mt-1">{market.resolution_rule}</p>
      <div className="mt-4">
        <OddsBar yesPrice={market.yes_price} noPrice={market.no_price} />
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={()=>onTrade('yes')} className="flex-1 bg-yes text-black font-bold py-3 rounded-full">YES</button>
        <button onClick={()=>onTrade('no')} className="flex-1 bg-no text-white font-bold py-3 rounded-full">NO</button>
      </div>
      <p className="text-xs text-white/40 mt-2">Volume ${market.volume}</p>
    </div>
  );
}
