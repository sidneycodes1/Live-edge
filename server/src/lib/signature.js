import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function canonicalStringify(obj) {
  const sorted = {};
  Object.keys(obj).sort().forEach((key) => {
    sorted[key] = obj[key];
  });
  return JSON.stringify(sorted);
}

export function signCanonical(secretKey, obj) {
  const msg = canonicalStringify(obj);
  const msgBytes = new TextEncoder().encode(msg);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

export function verifyCanonical(obj, signature, publicKey) {
  try {
    const msg = canonicalStringify(obj);
    const msgBytes = new TextEncoder().encode(msg);
    const sigBytes = bs58.decode(signature);
    const pubBytes = bs58.decode(publicKey);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}
