import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, getToken, setToken } from '../lib/api.js';
import { usePrivyBridge } from './usePrivyBridge.jsx';
import { shouldRunSessionExchange, runPrivySessionExchange } from '../lib/privy.js';

export const AuthContext = createContext(null);

export function useAuth() { return useContext(AuthContext); }

// ---------------------------------------------------------------------------
// Auth provider — PRIVY ONLY (docs/PRIVY_AUTH_SPEC.md Amendment 2: guest mode
// is removed; it is login-or-nothing). There is deliberately NO guest path
// here anymore:
//   * no on-mount getOrCreateGuestWallet() adoption (the browser keypair is no
//     longer an identity — it survives only as a signing internal, see
//     lib/wallet.js and the Amendment 2 launch-gate note in TradeSheet),
//   * no silent nonce/verify guest sign-in,
//   * no legacy email+password register/login/upgrade calls from the UI
//     (the server keeps those routes during the migration; the app must not
//     use them — TERMS_DRAFT §3: "legacy password accounts can't sign in
//     through the app anymore").
// Logged-out visitors browse public content; every account action opens the
// Privy modal via loginWithPrivy().
// ---------------------------------------------------------------------------
export function useAuthProvider() {
  const [user, setUser] = useState(null); // { id, wallet, email, kind, display_name, interests, ... }
  const [loading, setLoading] = useState(false);
  // null when Privy is not mounted (no VITE_PRIVY_APP_ID) -> sign-in UI shows
  // an honest "sign-in unavailable" state, never a fake button.
  const privy = usePrivyBridge();
  // Guards the silent exchange so it fires once per Privy session, not on every
  // re-render; reset on sign out so a later login re-runs it.
  const privyExchangeStarted = useRef(false);

  // On mount, hydrate from an existing our-JWT (set by a previous session
  // exchange in this tab). The JWT only carries id+wallet, so /me is the
  // source of truth for identity fields (name/interests/setup_completed).
  useEffect(() => {
    const tok = getToken();
    if (!tok) return;
    // optimistic decode so protected pages render immediately, then reconcile with /me
    try {
      const payload = JSON.parse(atob(tok.split('.')[1]));
      setUser({ id: payload.id, wallet: payload.wallet });
    } catch {
      setToken(null);
      return;
    }
    api.me().then((r) => setUser(r.user)).catch(() => { /* keep optimistic value */ });
  }, []);

  // Silent Privy session exchange (spec Diagram B "returning user"). Only runs
  // when Privy is ready AND authenticated. On success we adopt the returned
  // our-JWT + user. (The server may still ATTACH a did to a pre-Amendment-2
  // legacy account if a valid older JWT is present in the tab — same code path,
  // nothing guest-created.)
  useEffect(() => {
    if (!privy || !shouldRunSessionExchange({ ready: privy.ready, authenticated: privy.authenticated })) return;
    if (privyExchangeStarted.current) return;
    privyExchangeStarted.current = true;
    (async () => {
      const result = await runPrivySessionExchange({
        getAccessToken: () => privy.getAccessToken(),
        privySession: (t) => api.privySession(t),
        setToken,
      });
      if (result.exchanged && result.user) {
        setUser({ ...result.user, kind: result.user.kind || 'privy', just_created: result.just_created });
        // Reconcile the full identity from /me (name/interests/setup flags) and
        // keep the session's just_created for the welcome/congrats latch.
        const me = await api.me().catch(() => null);
        if (me && me.user) setUser({ ...me.user, kind: me.user.kind || 'privy', just_created: result.just_created });
      } else if (!result.exchanged) {
        // Honest no-op (e.g. no token): allow a later retry rather than latch off.
        privyExchangeStarted.current = false;
      }
    })().catch(() => { privyExchangeStarted.current = false; });
  }, [privy]);

  // Opens Privy's DEFAULT login modal (D3 + Amendment 3: email OTP / Google).
  // The exchange effect above completes the sign-in once Privy reports
  // authenticated, so this only needs to open the modal.
  const loginWithPrivy = useCallback(() => {
    if (privy && typeof privy.login === 'function') privy.login();
  }, [privy]);

  const signOut = useCallback(() => {
    // Best-effort server logout (stateless JWT -- the real effect is clearing the
    // token here). Never block the UI on it.
    api.logout().catch(() => {});
    setToken(null);
    setUser(null);
    privyExchangeStarted.current = false;
    // Also end the Privy session when Privy is mounted (spec: signOut calls logout).
    if (privy && typeof privy.logout === 'function') privy.logout().catch(() => {});
  }, [privy]);

  // Profile write (spec API contract 2 + the "You" sheet in BottomTabs). Returns
  // the updated publicUser so callers can reconcile name/interests immediately.
  const saveProfile = useCallback(async ({ displayName, interests }) => {
    setLoading(true);
    try {
      const { user: u } = await api.updateProfile({ displayName, interests });
      setUser((prev) => ({ ...u, kind: u.kind || 'privy', just_created: prev?.just_created }));
      return u;
    } finally {
      setLoading(false);
    }
  }, []);

  // Onboarding setup write (docs/ONBOARDING_PLAN.md §4 contract — route is built
  // IN PARALLEL by Agent A2; failures surface to the caller honestly).
  const completeSetup = useCallback(async ({ displayName, interests, termsVersion, accepted }) => {
    setLoading(true);
    try {
      const res = await api.meSetup({ displayName, interests, termsVersion, accepted });
      const u = res.user || null;
      // Keep the session's just_created flag: the congrats latch may still need
      // it after setup completes (just_created resume path, plan §4).
      if (u) setUser((prev) => ({ ...prev, ...u, just_created: prev?.just_created ?? u.just_created }));
      return res;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    user, loading, signOut, saveProfile, completeSetup,
    loginWithPrivy,
    // Consumers use this to decide the Sign-in trigger's behaviour: open the
    // Privy modal when Privy is live; without it there is NO sign-in path
    // (Amendment 2) and UIs must say so honestly.
    privyAvailable: Boolean(privy && privy.ready),
  };
}
