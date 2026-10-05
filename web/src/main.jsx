import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App.jsx';
import { PrivyBridgeProvider } from './hooks/usePrivyBridge.jsx';
import { isPrivyConfigured } from './lib/privy.js';
import './index.css';

// Privy appId arrives via the environment (spec "Environment"/"Client auth
// bridge"). When it is absent we mount the app WITHOUT PrivyProvider: the guest
// browser-keypair flow runs unchanged and we never hand Privy an empty appId
// (which would crash init and blank the page - an honest empty auth, not a
// half-configured one). Consumers read Privy through the bridge, which yields
// null here, so loginWithPrivy/privyAvailable degrade cleanly.
const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;
const container = document.getElementById('root');

if (isPrivyConfigured(privyAppId)) {
  createRoot(container).render(
    <PrivyProvider
      appId={privyAppId}
      config={{
        // D1: an embedded Solana wallet is created on login for users who have
        // none. Guests never log in to Privy, so they never get one (by design).
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
        // D3: Privy's DEFAULT modal (we own only the trigger). Minimal hint.
        appearance: { theme: 'dark' },
      }}
    >
      <PrivyBridgeProvider>
        <App />
      </PrivyBridgeProvider>
    </PrivyProvider>
  );
} else {
  createRoot(container).render(<App />);
}