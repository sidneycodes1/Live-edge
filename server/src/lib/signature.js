// Canonical JSON for signatures - ensures consistent key order and number formatting
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function canonicalStringify(obj) {
  // Sort keys alphabetically for deterministic ordering
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = obj[key];
  });
  return JSON.stringify(sorted);
}

export function signCanonical(secretKey, obj) {
  const msg = canonicalStringify(obj);
  return signMessage(secretKey, msg);
}

export function signMessage(secretKey, message) {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

export function verifyCanonical(messageObj, signature, wallet) {
  const msg = canonicalStringify(messageObj);
  const msgBytes = new TextEncoder().encode(msg);
  const sigBytes = bs58.decode(signature);
  const pubBytes = bs58.decode(wallet);
  return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
}
