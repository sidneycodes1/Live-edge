// Mandatory Panta attribution (Terms of Use §6). Wording is exactly "Powered by
// Panta", it links to panta.market, and it is NEVER user-dismissappable — there is
// deliberately no close control here. `variant` tunes prominence: a compact inline
// mark for a market card/panel, and a larger standalone one for the global footer.
// (Dropping the mark is an Enterprise/white-label business decision per ToU §12,
// not something a user toggles.)
export default function PoweredByPanta({ variant = 'inline', className = '' }) {
  const isFooter = variant === 'footer';
  return (
    <a
      data-testid="powered-by-panta"
      data-variant={variant}
      href="https://panta.market"
      target="_blank"
      rel="noopener noreferrer"
      title="Live prediction-market data powered by Panta"
      className={`inline-flex items-center gap-1.5 font-semibold tracking-wide text-white/70 hover:text-white transition min-h-[24px] ${
        isFooter ? 'text-sm' : 'text-[11px]'
      } ${className}`}
    >
      <span className={isFooter ? 'text-white/55' : 'text-white/45'}>Powered by</span>
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className={`rounded-full bg-live ${isFooter ? 'w-2 h-2' : 'w-1.5 h-1.5'}`}
        />
        <span className="font-heading font-bold text-live">Panta</span>
      </span>
    </a>
  );
}
