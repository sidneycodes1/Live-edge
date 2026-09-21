import { createContext, useContext, useState, useEffect } from 'react';
import { api, getToken, setToken } from '../lib/api.js';
import { getOrCreateGuestWallet, signMessage } from '../lib/wallet.js';

export const AuthContext = createContext(null);

export function useAuth() { return useContext(AuthContext); }

export function useAuthProvider() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    const w = getOrCreateGuestWallet();
    setWallet(w.publicKey);
    // try to decode token
    const tok = getToken();
    if (tok) {
      try {
        const payload = JSON.parse(atob(tok.split('.')[1]));
        setUser({ id: payload.id, wallet: payload.wallet });
      } catch {
        // Invalid token, ignore
      }
    }
  }, []);

  async function signIn() {
    setLoading(true);
    try {
      const gw = getOrCreateGuestWallet();
      const { message } = await api.nonce(gw.publicKey);
      const sig = signMessage(gw.secretKey, message);
      const { token, user: u } = await api.verify(gw.publicKey, sig);
      setToken(token);
      setUser(u);
      return u;
    } finally { setLoading(false); }
  }
  function signOut() { setToken(null); setUser(null); }
  return { user, wallet, loading, signIn, signOut };
}
