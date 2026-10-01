// Honest grid-status banner. Reflects which rung of the never-empty ladder served
// /api/live (docs §3/§4): real live, last-good cache (stale), the config standby
// channel (floor), or genuinely empty. It never dresses a degraded state up as live,
// and never shows at all when fresh real rows are present.

const COPY = {
  stale: { tone: 'warn', text: 'Showing your last live results — the providers are slow right now.' },
  floor: { tone: 'warn', text: 'No live partner streams right now — showing the standby channel.' },
  empty: { tone: 'muted', text: 'No live provider streams available right now — explore rooms below.' },
};

export default function LiveStatus({ servedFrom, degraded = [] }) {
  const c = COPY[servedFrom];
  if (!c) return null; // 'live' → real rows, no banner needed
  const toneClass = c.tone === 'warn'
    ? 'bg-live/10 text-live border-live/30'
    : 'bg-white/5 text-white/60 border-white/10';
  return (
    <div data-testid="live-status" role="status" className={`flex items-center gap-2 text-xs border rounded-card px-3 py-2 ${toneClass}`}>
      <span className="w-2 h-2 rounded-full bg-current shrink-0" />
      <span>{c.text}</span>
      {degraded.length > 0 && (
        <span className="text-white/40">
          ({degraded.map((d) => d.source).join(', ')} degraded)
        </span>
      )}
    </div>
  );
}
