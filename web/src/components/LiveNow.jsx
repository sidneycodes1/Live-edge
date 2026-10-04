import LiveCard from './LiveCard.jsx';
import Skeleton from './Skeleton.jsx';

// ---------------------------------------------------------------------------
// The landing "Live now" rail — the core deliverable. ONE horizontally
// scrollable shelf (snaps on mobile) of ≥12 honest cards, with three states:
//
//   • loading  → 12 neutral skeleton tiles (never a fake thumbnail/placeholder)
//   • empty    → ONE honest line "Catching the next broadcast…" + a retry button
//                (only when BOTH the playable grid and football feed came back
//                 empty — the rare degraded case)
//   • ready    → a mix of playable LiveCards + football score cards, already
//                composed & rotated by buildLiveNowCards() upstream.
//
// It owns NO data and invents NOTHING — it renders exactly what Discover hands it.
// ---------------------------------------------------------------------------

const SKELETON_COUNT = 12;

export default function LiveNow({ cards = [], loading = false, onRetry, title = 'Live now', icon, testid = 'rail-live' }) {
  return (
    <section className="mt-2" data-testid={testid}>
      <h2 className="font-heading font-bold text-lg text-white/85 mb-2 flex items-center gap-2">
        {icon && <span className="text-live inline-flex">{icon}</span>}
        <span>{title}</span>
      </h2>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 snap-x" data-testid="livenow-loading">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div key={i} className="snap-start shrink-0 w-[260px]">
              <div className="bg-surface rounded-card border border-white/10 overflow-hidden">
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div
          className="flex flex-col items-start gap-3 rounded-card border border-dashed border-white/15 bg-surface/50 px-5 py-8"
          data-testid="livenow-empty"
        >
          <p className="text-sm text-white/60">Catching the next broadcast…</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 bg-live/20 text-live hover:bg-live/30 transition"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 snap-x" data-testid="livenow-grid">
          {cards.map((ch) => (
            <div key={ch.id} className="snap-start shrink-0 w-[260px]">
              <LiveCard channel={ch} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
