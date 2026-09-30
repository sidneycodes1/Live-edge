import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Resolve the Twitch embed `parent` (bare serving domain) + Twitch feature flags.
// Precedence: server-provided TWITCH_PARENT_DOMAIN (config/env driven) else the
// current page hostname (works for localhost dev and the real deployed domain
// without hardcoding). Fetched once; never blocks rendering (defaults applied).
export function useTwitchConfig() {
  const [cfg, setCfg] = useState({
    // Sensible default: derive from the page so embeds work even before/if config
    // hasn't loaded. location.hostname is exactly what Twitch expects for `parent`.
    parent: typeof window !== 'undefined' ? window.location.hostname : '',
    enabled: false,
    fallbackChannel: '',
  });
  useEffect(() => {
    let cancelled = false;
    api.getConfig()
      .then((c) => {
        if (cancelled) return;
        const t = c?.twitch || {};
        setCfg({
          parent: (t.parentDomain && t.parentDomain.trim()) || (typeof window !== 'undefined' ? window.location.hostname : ''),
          enabled: Boolean(t.enabled),
          fallbackChannel: t.fallbackChannel || '',
        });
      })
      .catch(() => { /* keep hostname default */ });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}
