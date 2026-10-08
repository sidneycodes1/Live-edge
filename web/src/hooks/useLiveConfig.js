import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Resolve the embed `parent` domain + live feature flags from /api/config.
// Precedence: server-provided domain (env driven) else the current page
// hostname (works for localhost dev and the real deployed domain without
// hardcoding). Fetched once; never blocks rendering (defaults applied).
//
// History: this hook was born for the Twitch `parent` handshake. Twitch was
// retired (Oct 2026) — the hostname default survives because YouTube's
// live_chat iframe uses `embed_domain` the same way, and it costs nothing.
export function useLiveConfig() {
  const [cfg, setCfg] = useState({
    // Sensible default: derive from the page so embeds work even before/if config
    // hasn't loaded. location.hostname is exactly what the providers expect.
    parent: typeof window !== 'undefined' ? window.location.hostname : '',
    kickLive: false,
    kickFallbackChannel: '',
  });
  useEffect(() => {
    let cancelled = false;
    api.getConfig()
      .then((c) => {
        if (cancelled) return;
        const k = c?.kick || {};
        setCfg({
          parent: typeof window !== 'undefined' ? window.location.hostname : '',
          kickLive: Boolean(c?.features?.kickLive ?? k.enabled),
          kickFallbackChannel: k.fallbackChannel || '',
        });
      })
      .catch(() => { /* keep hostname default */ });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}
