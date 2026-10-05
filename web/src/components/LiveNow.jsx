import LiveCard from './LiveCard.jsx';
import Skeleton from './Skeleton.jsx';

// ---------------------------------------------------------------------------
// The landing "Live now" rail — the core deliverable. ONE horizontally
// scrollable shelf (snaps on mobile) of ≥12 honest cards, with three states:
//
//   • loading  → 12 neutral skeleton tiles (never a fake thumbnail/placeholder)
//   • empty    → ONE honest line "Catching the next broadcast…" + a retry button
//                (both the playable grid AND the football feed came back empty)
//   • collapse → the playable grid resolved to ZERO streams while football scores are
//                present. We say so honestly ("Streams are loading" + retry) and show
//                the scores under a caption — we never let it masquerade as a full
//                live rail (this is exactly the silent football-only wall to avoid).
//   • ready    → a mix of playable LiveCards + football score cards, already
//                composed & rotated by buildLiveNowCards() upstream.
//
// It owns NO data and invents NOTHING — it renders exactly what Discover hands it.
// ---------------------------------------------------------------------------

const SKELETON_COUNT = 12;

export default function LiveNow({ cards = [], loading = false, onRetry, playableCount, title = 'Live now', icon, testid = 'rail-live' }) {
  // How many non-football (playable) cards are present. Prefer the caller's number;
  // otherwise derive from the cards so the collapse check is always honest.
  const playable =
    typeof playableCount === 'number'
      ? playableCount
      : cards.filter((c) => c && c.source !== 'football-api').length;
  const footballOnly = !loading && cards.length > 0 && playable === 0;

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
        <>
          {footballOnly && (
            <div
              className="flex flex-col items-start gap-3 rounded-card border border-dashed border-white/15 bg-surface/50 px-5 py-6 mb-4"
              data-testid="livenow-collapse"
            >
              <p className="text-sm text-white/70">Streams are loading — we couldn’t fetch live broadcasts just now.</p>
              <p className="text-xs text-white/45">Match scores are shown below; they aren’t a stand-in for the broadcast grid.</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 bg-live/20 text-live hover:bg-live/30 transition"
                >
                  Retry streams
                </button>
              )}
            </div>
          )}
          {footballOnly && (
            <h3 className="text-[11px] uppercase tracking-wide text-white/45 mb-2">Match scores</h3>
          )}
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 snap-x" data-testid="livenow-grid">
            {cards.map((ch) => (
              <div key={ch.id} className="snap-start shrink-0 w-[260px]">
                <LiveCard channel={ch} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
