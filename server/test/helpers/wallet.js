import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { canonicalStringify } from '../../src/lib/signature.js';

export function genWallet() {
  const kp = nacl.sign.keyPair();
  return { kp, pub: bs58.encode(kp.publicKey), sec: kp.secretKey };
}
export function sign(kp, msg) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
}
export function signObj(kp, obj) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(canonicalStringify(obj)), kp.secretKey));
}
