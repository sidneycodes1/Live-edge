import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// Panel-modal context (owner decision, Oct 2026): checking your balance /
// portfolio and creating a bet are OVERLAYS on the current page — never
// full-screen routes you can get stuck on with no way back. Same shape as
// useAuthModal: App owns the open state; any trigger anywhere calls
// openPortfolio() / openCreator(opts); a single <PanelOverlay/> draws the box.
//
// `creator` carries how the Create overlay should open:
//   { roomId }            → jump straight to that room's cockpit
//   { prefillTitle }      → "Start a room" with a written question (match CTAs)
//   { prefillChannel }    → "Start a room" bound to a Kick channel
// ---------------------------------------------------------------------------

export const PanelModalContext = createContext({
  panel: null,
  creator: {},
  openPortfolio: () => {},
  openCreator: () => {},
  closePanel: () => {},
});

export function usePanelModal() {
  return useContext(PanelModalContext);
}
