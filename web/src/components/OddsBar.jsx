import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

// OddsBar animates its widths (framer-motion layout) AND, when the YES price moves,
// flashes the changed side once and shows a fading ▲/▼ delta chip. It tracks its own
// previous price via a ref, so callers just pass the current prices (from the room
// SSE feed or the Discover poll) and the motion "just happens".
export default function OddsBar({ yesPrice, noPrice }) {
  const yesPct = Math.round(yesPrice * 100);
  const noPct = 100 - yesPct;

  const prev = useRef(yesPrice);
  const [dir, setDir] = useState(null); // 'up' | 'down' | null
  const [delta, setDelta] = useState(0); // signed percentage-point change

  useEffect(() => {
    const d = yesPrice - prev.current;
    prev.current = yesPrice;
    if (d === 0) return;
    setDelta(Math.round(d * 100));
    setDir(d > 0 ? 'up' : 'down');
    const t = setTimeout(() => setDir(null), 900);
    return () => clearTimeout(t);
  }, [yesPrice]);

  return (
    <div className="w-full">
      <div className="flex h-3 rounded-full overflow-hidden bg-white/10">
        <motion.div layout className={`bg-yes ${dir === 'up' ? 'flash-up' : ''}`} style={{ width: `${yesPct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
        <motion.div layout className={`bg-no ${dir === 'down' ? 'flash-down' : ''}`} style={{ width: `${noPct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
      </div>
      <div className="flex justify-between text-xs mt-1 num">
        <span className="text-yes">
          YES {yesPct}%
          {dir === 'up' && <span className="mover-up ml-1">▲{Math.abs(delta)}</span>}
        </span>
        <span className="text-no">
          {dir === 'down' && <span className="mover-down mr-1">▼{Math.abs(delta)}</span>}
          NO {noPct}%
        </span>
      </div>
    </div>
  );
}
