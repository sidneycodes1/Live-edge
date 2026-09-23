import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { canonicalStringify as serverCanonical, signCanonical, verifyCanonical } from '../src/lib/signature.js';
import { canonicalStringify as webCanonical, signObject as webSignObject } from '../../web/src/lib/wallet.js';

// Fixed keypair from fixed 32-byte seed so fixtures are deterministic
const SEED = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
const KP = nacl.sign.keyPair.fromSeed(SEED);
const PUB = bs58.encode(KP.publicKey);

// Fixed payloads (deliberately declared in non-sorted key order to prove canonicalization)
const ORDER_PAYLOAD = {
  side: 'yes',
  orderId: '22222222-2222-4222-8222-222222222222',
  expiresAt: '2026-01-01T00:00:00.000Z',
  amount: 5,
  marketId: '11111111-1111-4111-8111-111111111111',
};
const ORDER_EXPECTED =
  '{"amount":5,"expiresAt":"2026-01-01T00:00:00.000Z","marketId":"11111111-1111-4111-8111-111111111111","orderId":"22222222-2222-4222-8222-222222222222","side":"yes"}';

const MARKET_PAYLOAD = {
  wallet: 'WALLET11111111111111111111111111111111',
  quoteId: '33333333-3333-4333-8333-333333333333',
  question: 'Will it rain?',
  nonce: 'fixed-nonce-123',
  kind: 'create_market',
};
const MARKET_EXPECTED =
  '{"kind":"create_market","nonce":"fixed-nonce-123","question":"Will it rain?","quoteId":"33333333-3333-4333-8333-333333333333","wallet":"WALLET11111111111111111111111111111111"}';

const CLAIM_PAYLOAD = {
  nonce: 'claim-nonce-456',
  wallet: 'WALLET22222222222222222222222222222222',
  marketId: '44444444-4444-4444-8444-444444444444',
  kind: 'claim_win',
};
const CLAIM_EXPECTED =
  '{"kind":"claim_win","marketId":"44444444-4444-4444-8444-444444444444","nonce":"claim-nonce-456","wallet":"WALLET22222222222222222222222222222222"}';

describe('signature fixtures (client === server === hardcoded)', () => {
  it('order-submit canonical strings match side by side', () => {
    const serverStr = serverCanonical(ORDER_PAYLOAD);
    const webStr = webCanonical(ORDER_PAYLOAD);
    console.log('CLIENT:', webStr);
    console.log('SERVER:', serverStr);
    assert.equal(webStr, serverStr);
    assert.equal(serverStr, ORDER_EXPECTED);
  });

  it('market-registration canonical strings match side by side', () => {
    const serverStr = serverCanonical(MARKET_PAYLOAD);
    const webStr = webCanonical(MARKET_PAYLOAD);
    console.log('CLIENT:', webStr);
    console.log('SERVER:', serverStr);
    assert.equal(webStr, serverStr);
    assert.equal(serverStr, MARKET_EXPECTED);
  });

  it('claim canonical strings match side by side', () => {
    const serverStr = serverCanonical(CLAIM_PAYLOAD);
    const webStr = webCanonical(CLAIM_PAYLOAD);
    console.log('CLIENT:', webStr);
    console.log('SERVER:', serverStr);
    assert.equal(webStr, serverStr);
    assert.equal(serverStr, CLAIM_EXPECTED);
  });

  it('real signature over order payload verifies on server', () => {
    const sigServer = signCanonical(KP.secretKey, ORDER_PAYLOAD);
    assert.ok(verifyCanonical(ORDER_PAYLOAD, sigServer, PUB));
    // web-side signer must also verify server-side
    const sigWeb = webSignObject(KP.secretKey, ORDER_PAYLOAD);
    assert.ok(verifyCanonical(ORDER_PAYLOAD, sigWeb, PUB));
  });

  it('real signature over market payload verifies on server', () => {
    const sigServer = signCanonical(KP.secretKey, MARKET_PAYLOAD);
    assert.ok(verifyCanonical(MARKET_PAYLOAD, sigServer, PUB));
    const sigWeb = webSignObject(KP.secretKey, MARKET_PAYLOAD);
    assert.ok(verifyCanonical(MARKET_PAYLOAD, sigWeb, PUB));
  });

  it('real signature over claim payload verifies on server', () => {
    const sigServer = signCanonical(KP.secretKey, CLAIM_PAYLOAD);
    assert.ok(verifyCanonical(CLAIM_PAYLOAD, sigServer, PUB));
    const sigWeb = webSignObject(KP.secretKey, CLAIM_PAYLOAD);
    assert.ok(verifyCanonical(CLAIM_PAYLOAD, sigWeb, PUB));
  });
});
