import { fmtUSD } from '../lib/format.js';
import { positionInsight, pnlLabel } from '../lib/positions.js';

// s8 — a position reads like a real bookmaker's slip: while the market is live
// its value is marked-to-market against what you actually paid (a signed P/L
// that ticks with the price), and once it settles the row tells the honest truth
// of the outcome — WON (with the payoff) or LOST — never a stale mid-board price.
// Every number comes straight off /api/portfolio (see lib/positions.js); this
// component only labels and colors it. The claim button keeps its Amendment-2
// signing gate exactly as before.
export default function PositionRow({ pos, onClaim }) {
  const i = positionInsight(pos);
  const resolved = pos.market.status === 'resolved';
  // Claim state only matters once the bet is resolved; while it is open there is
  // nothing to claim, so we surface the live state instead.
  const claimState = resolved ? (pos.claimed ? 'Claimed' : pos.claimable ? 'Claimable' : null) : null;

  const label = pnlLabel(i.pnl);
  const tone = i.kind === 'won' || i.pnl > 0
    ? 'text-yes'
    : i.kind === 'lost' || i.pnl < 0
      ? 'text-no'
      : 'text-white/60';
  const valueWord = i.kind === 'open' ? 'In-play value' : i.kind === 'pending' ? 'Value' : 'Settled value';
  const badgeTone = i.kind === 'won'
    ? 'bg-yes/15 text-yes'
    : i.kind === 'lost'
      ? 'bg-no/15 text-no'
      : 'bg-white/10 text-white/70';

  return (
    <div className="bg-surface border border-white/10 rounded-card p-4 flex items-center justify-between gap-3" data-testid="position-row">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{pos.market.question}</p>
        <p className="text-xs text-white/50">
          YES {pos.yesShares} · NO {pos.noShares}
          {i.invested != null && i.invested > 0 && <span> · Paid {fmtUSD(i.invested)}</span>}
        </p>
        <p className="text-xs mt-1 flex items-center gap-2 flex-wrap">
          <span className="text-white/70">{valueWord}</span>
          <span className="num font-semibold text-white/90">{i.value != null ? fmtUSD(i.value) : '—'}</span>
          {label && (
            <span className={`num font-bold ${tone}`} data-testid="position-pnl" title={i.kind === 'open' ? 'Live P/L, tracks the price' : 'Realized P/L'}>
              {label}
            </span>
          )}
        </p>
        <p className="text-xs mt-1 flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${badgeTone}`} data-testid="position-state">{i.headline}</span>
          {claimState && <span className="px-2 py-0.5 bg-white/10 rounded-full text-[11px] text-white/70">{claimState}</span>}
        </p>
      </div>
      {/* onClaim=null → signing launch gate closed (Amendment 2): honest disabled
          button, never a fake claim; onClaim=undefined → nothing to claim here. */}
      {pos.claimable && onClaim === null && (
        <button disabled data-testid="claim-disabled" className="shrink-0 bg-white/10 text-white/50 font-bold px-4 py-2 rounded-full text-sm cursor-not-allowed">Claim ${pos.claimAmount}</button>
      )}
      {pos.claimable && onClaim && <button onClick={()=>onClaim(pos)} className="shrink-0 bg-yes text-black font-bold px-4 py-2 rounded-full text-sm">Claim ${pos.claimAmount}</button>}
    </div>
  );
}
