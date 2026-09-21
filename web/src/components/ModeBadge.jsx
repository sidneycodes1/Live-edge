import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function ModeBadge() {
  const [cfg, setCfg] = useState(null);
  useEffect(()=>{ api.getConfig().then(setCfg).catch(()=>{}); }, []);
  if (!cfg) return null;
  const label = cfg.mode==='sim' ? 'Play money · simulated settlement' : cfg.mode==='hybrid' ? 'Real Panta data · simulated settlement' : 'Live';
  return <div className="text-xs px-3 py-1 rounded-full border border-white/10 bg-surface" style={{borderColor:'rgba(255,255,255,0.1)'}}>{label}</div>;
}
