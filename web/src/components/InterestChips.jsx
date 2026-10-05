import { INTEREST_VALUES } from '../lib/tailoring.js';

// ---------------------------------------------------------------------------
// The frozen three-chip interest vocabulary (docs/ONBOARDING_PLAN.md §2,
// Step 2). ONE component shared by the /welcome cover and the 'You' sheet so
// labels, values and the selected-state look never drift between the two.
// Values are the server contract: trading | sports | streams (max 3, unique).
// ---------------------------------------------------------------------------

export const INTEREST_OPTIONS = [
  { value: 'trading', label: 'Trading & News' },
  { value: 'sports', label: 'Sports' },
  { value: 'streams', label: 'Live Streams' },
];

export const ALL_INTERESTS = [...INTEREST_VALUES];

export default function InterestChips({ value = [], onChange, disabled = false }) {
  const selected = Array.isArray(value) ? value.filter((v) => INTEREST_OPTIONS.some((o) => o.value === v)) : [];
  const toggle = (v) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.slice(0, 3)); // server cap: 3 unique interests
  };
  return (
    <div className="flex flex-wrap gap-3" role="group" aria-label="What do you want to see first?">
      {INTEREST_OPTIONS.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            data-testid={`interest-${o.value}`}
            onClick={() => toggle(o.value)}
            className={`min-h-[44px] px-5 rounded-full border text-sm font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-default ${
              on
                ? 'bg-live text-white border-live'
                : 'bg-white/5 text-white/70 border-white/15 hover:border-white/40 hover:text-white'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
