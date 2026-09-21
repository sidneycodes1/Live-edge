// Guest demo wallet - play money only
import nacl from 'tweetnacl';
import bs58 from 'bs58';

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

export function signMessage(secretKey, message) {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

export function signObject(secretKey, obj) {
  const msg = JSON.stringify(obj);
  return signMessage(secretKey, msg);
}

export function getGuestWallet() {
  const w = getOrCreateGuestWallet();
  return w;
}
