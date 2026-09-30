// Honesty marker (plan §8): a single, quiet, always-present signal that the money
// on this surface is PLAY money. Every market here — even hybrid "real Panta data"
// — settles in simulated USDC, so "Play" is truthful on every card and panel.
// Deliberately low-contrast so it informs without shouting.
export default function MoneyChip({ className = '' }) {
  return (
    <span
      data-testid="money-chip"
      title="Play money — simulated settlement"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-semibold uppercase tracking-wide text-white/50 ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-live/70" />
      Play
    </span>
  );
}
