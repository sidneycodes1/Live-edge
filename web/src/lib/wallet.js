// Guest demo wallet - play money only
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// F-016 — guest signing key storage (deliberate, documented tradeoff).
// The guest keypair's secret key is kept in localStorage so a "Continue as guest"
// session survives reloads and the demo feels like a persistent wallet. This is
// acceptable ONLY because this wallet signs for simulated play money (SIM_USDC)
// that has no real-world value and lives entirely in our own DB — there is no
// external asset an attacker could drain. It is NOT for real custody.
// Threats to weigh before reuse with anything valuable: any XSS or a shared/dev
// machine can read localStorage; there is no device binding or passphrase.
// Mitigations if this ever guards real value: move the secret to sessionStorage
// (cleared per tab), or sign server-side via an HttpOnly-session-backed wallet.
const LS_KEY = 'liveedge_guest_secret';

export function getOrCreateGuestWallet() {
  let secret = window.localStorage.getItem(LS_KEY);
  if (secret) {
    try {
      const sec = bs58.decode(secret);
      const kp = nacl.sign.keyPair.fromSecretKey(sec);
      return { publicKey: bs58.encode(kp.publicKey), secretKey: sec, kp };
    } catch {
      // Invalid secret, will create new one
    }
  }
  const kp = nacl.sign.keyPair();
  const secretB58 = bs58.encode(kp.secretKey);
  window.localStorage.setItem(LS_KEY, secretB58);
  return { publicKey: bs58.encode(kp.publicKey), secretKey: kp.secretKey, kp };
}

// Canonical JSON for signatures - MUST stay byte-identical to server/src/lib/signature.js canonicalStringify.
// Both sort keys alphabetically then JSON.stringify. See server/test/signature-fixtures.test.js proof.
export function canonicalStringify(obj) {
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = obj[key];
  });
  return JSON.stringify(sorted);
}

export function signMessage(secretKey, message) {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

export function signObject(secretKey, obj) {
  const msg = canonicalStringify(obj);
  return signMessage(secretKey, msg);
}

export function getGuestWallet() {
  const w = getOrCreateGuestWallet();
  return w;
}
