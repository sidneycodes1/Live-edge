import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// Auth-modal context (owner decision, Oct 2026): signing in is an OVERLAY on
// the current page — never a navigation to a separate page. App owns the open
// state; every "Sign in" trigger anywhere in the tree calls openAuth().
// Split from App.jsx so consumers (WalletButton, BottomTabs, Portfolio,
// Discover…) can import the hook without a circular dependency.
// ---------------------------------------------------------------------------

export const AuthModalContext = createContext({ open: false, openAuth: () => {}, closeAuth: () => {} });

export function useAuthModal() {
  return useContext(AuthModalContext);
}
