// Honesty label for WHERE a market's displayed price came from (Door 1 / ToU §5).
// Every rendered price must be attributable: a real Panta quote ("Live · Panta"),
// a last-known-but-old one ("Stale · Panta · Xs ago"), or our OWN play-money number
// ("Simulated"). We never let a simulated/stale figure read as a live Panta quote.
//
// The label rules live in lib/market-source.js (unit-tested); this component only
// draws them. It also re-checks freshness client-side: a 'panta_live' price whose
// observed_at is already past the staleness window degrades to the honest "Stale"
// label even if the server hasn't swept it yet.
import { resolveSource, STALE_FALLBACK_MS } from '../lib/market-source.js';

const DOT_BY_TONE = {
  live: 'bg-live',
  stale: 'bg-amber-400',
  simulated: 'bg-white/40',
};

export default function MarketSourceChip({
  priceSource,
  observedAt,
  staleAfterMs = STALE_FALLBACK_MS,
  className = '',
}) {
  const { label, tone, age } = resolveSource({ priceSource, observedAt, staleAfterMs });
  const dot = DOT_BY_TONE[tone] || DOT_BY_TONE.simulated;

  return (
    <span
      data-testid="market-source-chip"
      data-price-source={priceSource || 'simulated'}
      data-tone={tone}
      title={
        tone === 'simulated'
          ? 'Our own play-money price — not a live market quote'
          : `Price mirrored from Panta${age ? ` · updated ${age}` : ''}`
      }
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-semibold uppercase tracking-wide text-white/60 ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
      {age && <span className="text-white/40 normal-case">· {age}</span>}
    </span>
  );
}
