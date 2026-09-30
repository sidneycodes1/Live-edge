import { useEffect, useRef } from 'react';

// A compact "live bets" strip fed by SSE `trade` events ({ name, side, amount }).
// Sits above the chat so the room feels like money is moving in real time. It
// renders NOTHING until a trade actually arrives — the FOMO comes from real
// movement, never a fabricated bet (plan §1.3 / §6).
export default function RecentBetsTicker({ events = [] }) {
  const trades = events.filter((e) => e.type === 'trade').slice(-12);
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [trades.length]);
  if (!trades.length) return null;
  return (
    <div data-testid="recent-bets-ticker" className="flex items-center gap-2 bg-surface border border-white/10 rounded-card px-3 py-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-live flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" /> Live bets
      </span>
      <div ref={ref} className="flex gap-2 overflow-x-auto no-scrollbar">
        {trades.map((t, i) => (
          <span key={i} className="shrink-0 text-xs bg-black/30 border border-white/10 rounded-full px-2.5 py-1 whitespace-nowrap">
            <b className="text-white/85">{t.data.name || 'Someone'}</b>{' '}
            backed <span className={t.data.side === 'yes' ? 'text-yes font-semibold' : 'text-no font-semibold'}>{String(t.data.side || '').toUpperCase()}</span>{' '}
            <span className="num text-white/55">${t.data.amount}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
