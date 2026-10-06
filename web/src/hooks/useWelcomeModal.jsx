import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// Welcome-modal context (owner decision, Oct 2026): the 3-step onboarding is an
// OVERLAY on the live feed — the same centered, blurred-backdrop treatment as
// the sign-in box — never a full-screen page takeover. App owns the open state;
// the landing gate auto-opens it for a brand-new sign-up, and the resume bar /
// a /welcome deep link reopen it. Split from App.jsx so consumers can import the
// hook without a circular dependency.
// ---------------------------------------------------------------------------

export const WelcomeModalContext = createContext({ open: false, openWelcome: () => {}, closeWelcome: () => {} });

export function useWelcomeModal() {
  return useContext(WelcomeModalContext);
}
