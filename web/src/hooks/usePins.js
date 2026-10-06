import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken } from '../lib/api.js';
import { pinBodyFromCard, MAX_PINS } from '../lib/pins.js';
import { useAuth } from './useAuth.js';

// ---------------------------------------------------------------------------
// The user's pinned-stream shelf. Pins persist SERVER-side (max 4), so they
// survive reloads and follow the account, not the browser. Guest mode is
// REMOVED (docs/PRIVY_AUTH_SPEC.md Amendment 2): a signed-out visitor who
// clicks pin gets reason 'login' — the caller (Discover) shows the sign-in
// OVERLAY trigger, never a silent guest sign-in.
// ---------------------------------------------------------------------------
export function usePins() {
  const { user } = useAuth();
  const [pins, setPins] = useState([]);

  const load = useCallback(() => {
    if (!getToken()) {
      setPins([]);
      return;
    }
    api.getPins().then((r) => setPins(r.items || [])).catch(() => {});
  }, []);

  // Refetch whenever the signed-in account changes (login via the Privy modal
  // must pull the real shelf in without a page reload).
  useEffect(() => { load(); }, [load, user?.id]);

  const pinnedIds = useMemo(() => new Set(pins.map((p) => String(p.stream_id))), [pins]);

  // Returns {ok, reason} so the UI can explain a refusal honestly
  // ('login' = sign-in required — the caller surfaces the overlay trigger,
  //  'limit' = all 4 slots full, 'error' = network/server).
  async function toggle(card) {
    const body = pinBodyFromCard(card);
    if (!body) return { ok: false, reason: 'no-id' };
    if (!getToken()) {
      // Login-or-nothing (Amendment 2): the pin itself is NOT queued or faked
      // — the caller shows the sign-in overlay and the user taps again once
      // signed in.
      return { ok: false, reason: 'login' };
    }
    try {
      if (pinnedIds.has(body.streamId)) {
        const r = await api.unpin(body.streamId);
        setPins(r.items || []);
        return { ok: true };
      }
      if (pins.length >= MAX_PINS) return { ok: false, reason: 'limit' };
      const r = await api.pin(body);
      setPins(r.items || []);
      return { ok: true };
    } catch (e) {
      if (e.code === 'PIN_LIMIT') return { ok: false, reason: 'limit' };
      return { ok: false, reason: 'error' };
    }
  }

  return { pins, pinnedIds, toggle, max: MAX_PINS, full: pins.length >= MAX_PINS };
}
