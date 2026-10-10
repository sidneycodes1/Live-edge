import { useState } from 'react';
import LiveTile from './LiveTile.jsx';
import Skeleton from './Skeleton.jsx';
import { visibleItems, canExpand, isEmptySection, emptyStateLabel } from '../lib/landing.js';

// ---------------------------------------------------------------------------
// CategorySection — one titled landing section (contract §4/§5, Agent C).
// 3-column grid on desktop (lg:grid-cols-3), 2 on sm, 1 on mobile. Shows the
// first 3 cards collapsed; "Show more" reveals up to 9 (3×3) — sliced from the
// rows actually fetched, never padded. An empty bucket renders an HONEST empty
// state: no backfill from other providers/buckets, no invented cards (§1).
//
// `renderCard` lets a section override the default LiveTile if ever needed.
// ---------------------------------------------------------------------------

export default function CategorySection({
  title,
  sectionKey,
  items = [],
  loading = false,
  testid,
  pinnedIds,
  onTogglePin,
  renderCard,
  fallbackNote,
}) {
  const [expanded, setExpanded] = useState(false);
  const sid = testid || `section-${sectionKey}`;
  const shown = visibleItems(items, expanded);
  const Card = renderCard
    || ((ch) => <LiveTile channel={ch} pinned={pinnedIds?.has(String(ch.id))} onTogglePin={onTogglePin} />);

  return (
    <section className="mt-8" data-testid={sid}>
      <h2 className="font-heading font-bold text-lg text-white/85 flex items-center gap-2">
        <span>{title}</span>
      </h2>

      {/* s4: the section was empty on Kick and the server backfilled it with
          labelled YouTube rows — say so plainly, above the grid. */}
      {!loading && fallbackNote && (
        <p className="text-xs text-white/55 mt-1.5" data-testid={`${sid}-fallback-note`}>
          {fallbackNote}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3 min-w-0" data-testid={`${sid}-loading`}>
          <Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" />
        </div>
      ) : isEmptySection(items) ? (
        <div
          className="rounded-card border border-dashed border-white/15 bg-surface/50 px-5 py-8 mt-3"
          data-testid={`${sid}-empty`}
        >
          <p className="text-sm text-white/60">{emptyStateLabel(sectionKey)}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3 min-w-0" data-testid={`${sid}-grid`}>
            {shown.map((ch, i) => (
              <div key={String(ch?.id ?? `${sid}-${i}`)} className="min-w-0">
                {Card(ch)}
              </div>
            ))}
          </div>
          {canExpand(items) && (
            <button
              type="button"
              data-testid={`${sid}-show-more`}
              onClick={() => setExpanded((e) => !e)}
              className="mt-3 text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 bg-live/20 text-live hover:bg-live/30 transition cursor-pointer"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
