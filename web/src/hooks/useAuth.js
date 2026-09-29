import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getToken, setToken } from '../lib/api.js';
import { getOrCreateGuestWallet, signMessage } from '../lib/wallet.js';

export const AuthContext = createContext(null);

export function useAuth() { return useContext(AuthContext); }

export function useAuthProvider() {
  const [user, setUser] = useState(null); // { id, wallet, email, kind, display_name }
  const [loading, setLoading] = useState(false);
  const [wallet, setWallet] = useState(null);

  // On mount, adopt the browser guest wallet (always present; it is the signing
  // identity) and, if a token exists, hydrate the full user (kind/email) from
  // /me — the JWT only carries id+wallet, so /me is the source for identity type.
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

  const signOut = useCallback(() => {
    // Best-effort server logout (stateless JWT — the real effect is clearing the
    // token here). Never block the UI on it.
    api.logout().catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  return { user, wallet, loading, signIn, signOut, register, login, upgrade };
}
