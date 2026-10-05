import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, getToken, setToken } from '../lib/api.js';
import { getOrCreateGuestWallet, signMessage } from '../lib/wallet.js';
import { usePrivyBridge } from './usePrivyBridge.jsx';
import { shouldRunSessionExchange, runPrivySessionExchange } from '../lib/privy.js';

export const AuthContext = createContext(null);

export function useAuth() { return useContext(AuthContext); }

export function useAuthProvider() {
  const [user, setUser] = useState(null); // { id, wallet, email, kind, display_name }
  const [loading, setLoading] = useState(false);
  const [wallet, setWallet] = useState(null);
  // null when Privy is not mounted (no VITE_PRIVY_APP_ID) -> guest flow unchanged.
  const privy = usePrivyBridge();
  // Guards the silent exchange so it fires once per Privy session, not on every
  // re-render; reset on sign out so a later login re-runs it.
  const privyExchangeStarted = useRef(false);

  // On mount, adopt the browser guest wallet (always present; it is the signing
  // identity) and, if a token exists, hydrate the full user (kind/email) from
  // /me -- the JWT only carries id+wallet, so /me is the source for identity type.
  useEffect(() => {
    const w = getOrCreateGuestWallet();
    setWallet(w.publicKey);
    const tok = getToken();
    if (!tok) return;
    // optimistic decode so protected pages render immediately, then reconcile with /me
    try {
      const payload = JSON.parse(atob(tok.split('.')[1]));
      setUser({ id: payload.id, wallet: payload.wallet, kind: 'guest' });
    } catch {
      setToken(null);
      return;
    }
    api.me().then((r) => setUser(r.user)).catch(() => { /* keep optimistic value */ });
  }, []);

  // Silent Privy session exchange (spec Diagram B "returning user"). Only runs
  // when Privy is ready AND authenticated; a guest (privy null or not
  // authenticated) never reaches the session route. On success we adopt the
  // returned our-JWT + user; if a guest JWT was already stored the server ATTACHES
  // the did to that account (path b) and the balance/pins carry over.
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
        // Reconcile the full identity from /me (name/interests/balance) like the
        // guest path does; keep the session's just_created for the welcome sheet.
        const me = await api.me().catch(() => null);
        if (me && me.user) setUser({ ...me.user, kind: me.user.kind || 'privy', just_created: result.just_created });
      } else if (!result.exchanged) {
        // Honest no-op (e.g. no token): allow a later retry rather than latch off.
        privyExchangeStarted.current = false;
      }
    })().catch(() => { privyExchangeStarted.current = false; });
  }, [privy]);

  // Guest sign-in (existing path, unchanged): prove ownership of the wallet.
  async function signIn() {
    setLoading(true);
    try {
      const gw = getOrCreateGuestWallet();
      const { message } = await api.nonce(gw.publicKey);
      const sig = signMessage(gw.secretKey, message);
      const { token, user: u } = await api.verify(gw.publicKey, sig);
      setToken(token);
      setUser({ ...u, kind: u.kind || 'guest' });
      return u;
    } finally { setLoading(false); }
  }

  async function register(email, password) {
    setLoading(true);
    try {
      const gw = getOrCreateGuestWallet();
      const { token, user: u } = await api.register(email, password, gw.publicKey);
      setToken(token);
      setUser(u);
      return u;
    } finally { setLoading(false); }
  }

  async function login(email, password) {
    setLoading(true);
    try {
      const { token, user: u } = await api.login(email, password);
      setToken(token);
      setUser(u);
      return u;
    } finally { setLoading(false); }
  }

  // Signed-in guest attaches email+password to the SAME account (same id).
  async function upgrade(email, password) {
    setLoading(true);
    try {
      const { token, user: u } = await api.upgrade(email, password);
      setToken(token);
      setUser(u);
      return u;
    } finally { setLoading(false); }
  }

  // Opens Privy's DEFAULT wallet-login modal (D3 -- no custom login screen).
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

  return {
    user, wallet, loading, signIn, signOut, register, login, upgrade,
    loginWithPrivy,
    // WalletButton uses this to decide the Sign-in trigger's behaviour: open the
    // Privy modal when Privy is live, otherwise the existing /signin guest page.
    privyAvailable: Boolean(privy && privy.ready),
  };
}