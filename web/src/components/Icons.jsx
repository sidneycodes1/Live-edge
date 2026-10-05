// Inline SVG icon set (design-system MASTER: "no emoji as icons — use SVG").
// All icons inherit `currentColor`, share a 24px grid and a 2px stroke, and are
// decorative by default (aria-hidden) — pair them with visible text, or give an
// icon-only control an explicit aria-label at the call site.
const base = (cls) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  className: cls || 'w-4 h-4',
});

export function IconBall({ className } = {}) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l3.5 2.5-1.3 4h-4.4l-1.3-4L12 7z" />
      <path d="M12 3v4M4.5 9.5L8 11M19.5 9.5L16 11M6.5 19l2.8-4M17.5 19l-2.8-4" />
    </svg>
  );
}

export function IconFlame({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M12 3s4 3.5 4 8a4 4 0 0 1-8 0c0-1 .3-1.8.7-2.5C9 10 9.5 11 10.5 11 10 8 12 5 12 3z" />
      <path d="M12 21a7 7 0 0 0 7-7c0-2-1-3.5-1-3.5" />
    </svg>
  );
}

export function IconBell({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function IconClock({ className } = {}) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconTrending({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function IconPin({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M12 17v5" />
      <path d="M9 10.8V4h6v6.8l2.5 2.7a1 1 0 0 1-.8 1.5H7.3a1 1 0 0 1-.8-1.5z" />
    </svg>
  );
}

export function IconPlay({ className } = {}) {
  return (
    <svg {...base(className)} fill="currentColor" stroke="none">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function IconExternal({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function IconChevronLeft({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ className } = {}) {
  return (
    <svg {...base(className)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Bottom-tab icons (nav restructure): magnifier, portfolio wallet, person.
// Stroke-only and currentColor like the whole set — no emoji anywhere.
export function IconSearch({ className } = {}) {
  return (
    <svg {...base(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function IconPortfolio({ className } = {}) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </svg>
  );
}

export function IconUser({ className } = {}) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
