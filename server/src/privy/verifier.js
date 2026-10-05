import bs58 from 'bs58';
import { PrivyClient } from '@privy-io/node';

// Privy's hosted auth API (the base the Node SDK talks to for JWKS + user reads).
const PRIVY_AUTH_API_URL = 'https://auth.privy.io';

// A Privy embedded Solana (Ed25519) address is a 32-byte key encoded in base58 —
// exactly the shape `users.wallet` already stores (spec D1). Reject anything else
// so a malformed SDK value can never poison the wallet column.
export function isBs58Pubkey(value) {
  try {
    return bs58.decode(String(value)).length === 32;
  } catch {
    return false;
  }
}

// Pull the embedded Solana address out of a Privy user object. The access-token
// claims carry only the DID, so the wallet comes from the user lookup: a linked
// account with chain_type 'solana' + connector_type 'embedded'. Absent → undefined
// (the brand-new-user path must then 401 per spec — never invent a wallet, §2 honesty).
export function embeddedSolanaAddress(user) {
  const accounts = (user && (user.linked_accounts || user.linkedAccounts)) || [];
  for (const acct of accounts) {
    if (
      acct &&
      acct.chain_type === 'solana' &&
      acct.connector_type === 'embedded' &&
      acct.address &&
      isBs58Pubkey(acct.address)
    ) {
      return acct.address;
    }
  }
  return undefined;
}

// Factory the auth route depends on. It returns a NORMALIZED verifier:
//   verifyPrivyToken(accessToken) -> Promise<{ did: string, solanaAddress?: string }>
// which throws on an invalid/expired token (the route maps that to 401). Hermetic
// tests inject a fake with this SAME shape, so no live network is touched (spec:
// "Privy verification MOCKED by injection ... No live network in tests").
//
// SDK NOTE (DEVIATION from the spec's assumed surface — see report): the spec named
// `@privy-io/server-auth`'s `verifyAccessToken(token, { appId, appSecret })` returning
// `{ did, user }`. The INSTALLED packages do not expose that. `@privy-io/node` (the
// modern server SDK) verifies via `PrivyClient.utils().auth().verifyAccessToken(token)`
// which returns claims only (`user_id` = the DID); the embedded wallet requires a
// separate `PrivyClient.users()._get(did)` read. Both are verified against the
// installed .d.ts. The route contract (request/response) is unchanged.
export function createPrivyVerifier(env) {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  // Strict degrade, mirroring every other provider in env.js: no creds → the
  // feature is disabled (the route answers 503), never a boot crash.
  if (!appId || !appSecret) return null;

  const client = new PrivyClient({ appId, appSecret, apiUrl: PRIVY_AUTH_API_URL });

  return async function verifyPrivyToken(accessToken) {
    // Throws InvalidAuthTokenError on a bad/expired token → the route turns that into 401.
    const claims = await client.utils().auth().verifyAccessToken(accessToken);
    const did = claims && (claims.user_id || claims.userId);
    if (!did) throw new Error('Privy token had no user id');
    let solanaAddress;
    try {
      const user = await client.users()._get(did);
      solanaAddress = embeddedSolanaAddress(user);
    } catch {
      // A user-read failure is not a token failure: leave the wallet undefined so
      // path (a)/(b) still succeed and path (c) honestly 401s (no fabricated wallet).
      solanaAddress = undefined;
    }
    return { did, solanaAddress };
  };
}
