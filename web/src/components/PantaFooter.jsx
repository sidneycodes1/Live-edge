import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PoweredByPanta from './PoweredByPanta.jsx';

// Global "Powered by Panta" footer (Terms of Use §6). It appears on every surface
// ONLY when the server reports Panta real-time is actually running (a live poller
// backed by a real key) — a purely-simulated build shows nothing, which stays
// honest about there being no Panta data in play. It is deliberately
// non-dismissappable: there is no close control, and dropping the mark is an
// Enterprise/white-label business decision (ToU §12), not a user toggle.
export default function PantaFooter() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    let alive = true;
    api.getConfig().then((c) => { if (alive) setCfg(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!cfg?.panta?.realtimeEnabled) return null;
  return (
    <footer
      data-testid="panta-footer"
      className="mt-8 py-4 px-4 flex items-center justify-center gap-2 border-t border-white/10 text-xs text-white/40"
    >
      <span className="text-white/40">Live prediction-market data</span>
      <PoweredByPanta variant="footer" />
    </footer>
  );
}
