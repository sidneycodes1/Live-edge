import LiveCard from './LiveCard.jsx';

// A horizontal shelf of provider-agnostic LiveCards. Mirrors the rooms Rail but
// for the /api/live grid. Renders nothing when empty so an unavailable rail (e.g.
// no football rows) never shows a blank section (docs §2: empty rails are hidden).
export default function LiveRail({ title, icon, channels = [], testid }) {
  if (!channels.length) return null;
  return (
    <section className="mt-7" data-testid={testid}>
      <h2 className="font-heading font-bold text-base text-white/85 mb-2 flex items-center gap-2">
        {icon && <span className="text-live inline-flex">{icon}</span>}
        <span>{title}</span>
      </h2>
      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 snap-x">
        {channels.map((ch) => (
          <div key={ch.id} className="snap-start shrink-0 w-[260px]">
            <LiveCard channel={ch} />
          </div>
        ))}
      </div>
    </section>
  );
}
