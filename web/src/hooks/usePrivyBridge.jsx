import { createContext, useContext } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// The app can run WITHOUT Privy configured (no VITE_PRIVY_APP_ID): then no
// PrivyProvider is mounted, and calling usePrivy() there would throw. We never
// call usePrivy() outside the provider. Instead this bridge publishes the real
// handle into OUR OWN context (default null), so useAuth / WalletButton get
// `null` when Privy is absent -> the guest browser-keypair flow stays exactly as
// before and nothing crashes (docs/PRIVY_AUTH_SPEC.md "Client auth bridge").
const PrivyBridgeContext = createContext(null);

// Rendered ONLY as a child of <PrivyProvider> (see main.jsx), so usePrivy() here
// is always valid.
export function PrivyBridgeProvider({ children }) {
  const privy = usePrivy();
  return <PrivyBridgeContext.Provider value={privy}>{children}</PrivyBridgeContext.Provider>;
}

// Returns the Privy handle (ready/authenticated/login/logout/getAccessToken/user)
// or null when Privy is not mounted/configured.
export function usePrivyBridge() {
  return useContext(PrivyBridgeContext);
}