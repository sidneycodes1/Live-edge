import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function genWallet() {
  const kp = nacl.sign.keyPair();
  return { kp, pub: bs58.encode(kp.publicKey), sec: kp.secretKey };
}
export function sign(kp, msg) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
}
export function signObj(kp, obj) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(JSON.stringify(obj)), kp.secretKey));
}
