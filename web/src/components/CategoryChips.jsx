// Twitch "Games / IRL / …" style category filter row. Categories are derived from
// the live rooms themselves (no invented taxonomy). Selecting one filters the main
// grid; "All" clears it.
export default function CategoryChips({ categories = [], active, onSelect }) {
  if (!categories.length) return null;
  const opts = ['All', ...categories];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Categories">
      {opts.map((c) => {
        const isActive = c === 'All' ? !active : active === c;
        return (
          <button
            key={c}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(c === 'All' ? null : c)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition capitalize ${isActive ? 'bg-white text-black border-white font-semibold' : 'bg-surface text-white/70 border-white/10 hover:border-white/25'}`}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
