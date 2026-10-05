// Privy client-auth logic - PURE + injectable so it is unit-testable with vitest
// (docs/PRIVY_AUTH_SPEC.md "Client auth bridge"). No React, no window, no
// import.meta lives here: every external effect (the access token, the session
// POST, setToken) is INJECTED by the caller, so tests fake them (the repo's
// mocked-fetch contract). useAuth.js wires the real Privy + api deps in.

// Phase-0 signing spike did NOT record SIGNING_OK, so per the spec's SPIKE GATE
// (Diagram C) the embedded Solana wallet is NOT used for signing; the guest
// browser keypair keeps signing. Flip this to true ONLY when a real
// solana_signMessage -> nacl.sign.detached.verify proof is captured against our
// /api fixtures. Keeping it false is the spec-sanctioned fallback, not a stub.
export const EMBEDDED_SIGNING_VERIFIED = false;

// The appId reaches the client via the environment (see spec "Environment").
// Privy is "configured" only when a non-empty appId is present; otherwise we
// mount the app WITHOUT PrivyProvider and the guest flow runs unchanged.
export function isPrivyConfigured(appId) {
  return typeof appId === 'string' && appId.trim().length > 0;
}

// Guests are never Privy-authenticated, so they hold no access token and must
// never call /auth/privy/session (spec: "no token for guests" is correct BY
// DESIGN). Only run the exchange once Privy is ready AND authenticated.
export function shouldRunSessionExchange({ ready, authenticated } = {}) {
  return Boolean(ready) && Boolean(authenticated);
}

// Session-exchange sequencing (deliverable 2):
//   getAccessToken() -> (skip if null) -> privySession(token) -> setToken(ourJwt)
// `privySession` is expected to carry the existing guest JWT itself (api.js does
// that via the stored bearer), so the server can ATTACH the did to the guest.
// Returns a small result so the caller can surface just_created (welcome sheet).
export async function runPrivySessionExchange({ getAccessToken, privySession, setToken }) {
  const privyToken = await getAccessToken();
  if (!privyToken) return { exchanged: false, reason: 'no-token' };
  const res = await privySession(privyToken);
  if (!res || !res.token) return { exchanged: false, reason: 'no-session-token', response: res || null };
  setToken(res.token);
  const user = res.user || null;
  return { exchanged: true, token: res.token, user, just_created: isJustCreated(user) };
}

// Signer choice (deliverable 4). The embedded wallet is used ONLY when the spike
// verified signing (EMBEDDED_SIGNING_VERIFIED / embeddedSigningEnabled) AND a
// usable Privy embedded Solana wallet exists; otherwise the guest keypair signs
// (spec fallback). Returns a discriminated descriptor; the caller performs the
// actual signing so no SDK/Provider type is required by this pure function.
export function resolveSigner({
  embeddedWallet,
  guestWallet,
  embeddedSigningEnabled = EMBEDDED_SIGNING_VERIFIED,
} = {}) {
  if (
    embeddedSigningEnabled &&
    embeddedWallet &&
    embeddedWallet.address &&
    typeof embeddedWallet.getProvider === 'function'
  ) {
    return { kind: 'embedded', wallet: embeddedWallet };
  }
  return { kind: 'guest', wallet: guestWallet };
}

// just_created passthrough helper (used by the exchange + welcome trigger).
export function isJustCreated(user) {
  return !!(user && user.just_created);
}