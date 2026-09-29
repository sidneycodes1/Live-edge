import { createContext, useContext } from 'react';

// Toast is provided once at the app root (App.jsx) and consumed by any page that
// needs user feedback. Phase 1 wires the existing (previously dead) Toast through
// context; the full notification center is deferred to a later phase.
export const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}
