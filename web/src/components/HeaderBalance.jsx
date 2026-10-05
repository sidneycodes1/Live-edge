import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useBalance } from '../hooks/useBalance.js';
import { consumeBalanceMirror, countUpFrame, formatUsd, COUNTUP_DURATION_MS, WELCOME_TARGET_USD } from '../lib/welcome.js';

// Live balance shown next to the wallet on every authenticated page (T2). Reads
// from the single BalanceContext, so it cannot drift from Portfolio's number.
// Post-congrats mirror: the /welcome flow arms a one-shot sessionStorage flag,
// and the first mount after it replays the SAME 600ms $0.00→$100.00 count-up
// here (spec: "header balance chip mirrors the count-up"), static under
// prefers-reduced-motion. After the replay it shows the real server balance.
export default function HeaderBalance() {
  const { user } = useAuth();
  const { balance } = useBalance() || {};
  const [mirroring, setMirroring] = useState(() => consumeBalanceMirror(window.sessionStorage));
  const [frame, setFrame] = useState('$0.00');

  useEffect(() => {
    if (!mirroring) return undefined;
    let reduced = false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* no matchMedia -> animate */
    }
    if (reduced) {
      setMirroring(false);
      return undefined;
    }
    let raf = 0;
    const t0 = window.performance.now();
    const tick = (now) => {
      const elapsed = now - t0;
      if (elapsed >= COUNTUP_DURATION_MS) {
        setFrame(formatUsd(WELCOME_TARGET_USD));
        setMirroring(false); // hand back to the real server number
        return;
      }
      setFrame(countUpFrame({ elapsedMs: elapsed }));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    // Same guarantee as the congrats screen: rAF is suspended in a backgrounded
    // tab, and without this the chip would keep showing the animation's "$0.00"
    // instead of handing back to the user's REAL server balance.
    const land = window.setTimeout(() => {
      setFrame(formatUsd(WELCOME_TARGET_USD));
      setMirroring(false);
    }, COUNTUP_DURATION_MS + 120);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(land);
    };
  }, [mirroring]);

  if (!user) return null;
  const shown = mirroring ? frame : balance == null ? '—' : `$${Number(balance).toFixed(2)}`;
  return (
    <Link
      to="/portfolio"
      className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full num font-bold min-h-[24px] inline-flex items-center"
      data-testid="header-balance"
    >
      {shown}
    </Link>
  );
}
