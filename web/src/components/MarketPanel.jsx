import OddsBar from './OddsBar.jsx';
import { fmtTimeLeft } from '../lib/format.js';

export default function MarketPanel({ market, onTrade }) {
  if (!market) return <div className="p-4 text-white/50">No market yet</div>;
  return (
    <div className="bg-surface rounded-card border border-white/10 p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className={`px-2 py-1 rounded-full text-xs ${market.status==='open'?'bg-live text-black':'bg-white/10'}`}>{market.status}</span>
        {market.status==='open' && <span className="text-white/50">{fmtTimeLeft(market.end_time)}</span>}
        {market.graduated && <span className="ml-auto text-yes text-xs">graduated</span>}
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
