import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken } from '../lib/api.js';
import { pinBodyFromCard, MAX_PINS } from '../lib/pins.js';
import { useAuth } from './useAuth.js';

// ---------------------------------------------------------------------------
// The user's pinned-stream shelf. Pins persist SERVER-side (max 4), so they
// survive reloads and follow the account, not the browser. A signed-out
// visitor who clicks pin gets the existing silent guest sign-in first (same
// flow as "Continue as guest") so their shelf is real immediately.
// ---------------------------------------------------------------------------
export function usePins() {
  const { user, signIn } = useAuth();
  const [pins, setPins] = useState([]);

  const load = useCallback(() => {
    if (!getToken()) {
      setPins([]);
      return;
    }
    api.getPins().then((r) => setPins(r.items || [])).catch(() => {});
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const pinnedIds = useMemo(() => new Set(pins.map((p) => String(p.stream_id))), [pins]);

  // Returns {ok, reason} so the UI can explain a refusal honestly
  // ('limit' = all 4 slots full, 'error' = network/server).
  async function toggle(card) {
    const body = pinBodyFromCard(card);
    if (!body) return { ok: false, reason: 'no-id' };
    let signedIn = Boolean(getToken());
    if (!signedIn) {
      try {
        await signIn();
        signedIn = true;
      } catch {
        return { ok: false, reason: 'sign-in' };
      }
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
