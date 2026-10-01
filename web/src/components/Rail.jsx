import MarketCard from './MarketCard.jsx';

// A horizontal "shelf" that re-presents the SAME rooms through a different lens
// (movers / closing soon / trending). This is what makes a handful of seeded rooms
// read as a full platform — abundance by re-sorting, never by inventing markets.
// Renders nothing when empty so a lens with no matches simply disappears.
export default function Rail({ title, icon, rooms = [], testid }) {
  if (!rooms.length) return null;
  return (
    <section className="mt-7" data-testid={testid}>
      <h2 className="font-heading font-bold text-base text-white/85 mb-2 flex items-center gap-2">
        {icon && <span className="text-live inline-flex">{icon}</span>}
        <span>{title}</span>
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
        {rooms.map((r) => (
          <div key={r.id} className="snap-start shrink-0 w-[280px]">
            <MarketCard room={r} />
          </div>
        ))}
      </div>
    </section>
  );
}
