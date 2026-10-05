import { describe, it, expect, vi } from 'vitest';
import {
  isPrivyConfigured,
  shouldRunSessionExchange,
  runPrivySessionExchange,
  resolveSigner,
  isJustCreated,
  EMBEDDED_SIGNING_VERIFIED,
} from './privy.js';

// Pure logic only (no jsdom, no React). External effects are injected fakes, so
// these tests honour the repo's mocked-fetch contract without touching network.

describe('isPrivyConfigured', () => {
  it('is true only for a non-empty, non-blank appId', () => {
    expect(isPrivyConfigured('app_123')).toBe(true);
    expect(isPrivyConfigured('')).toBe(false);
    expect(isPrivyConfigured('   ')).toBe(false);
    expect(isPrivyConfigured(undefined)).toBe(false);
    expect(isPrivyConfigured(null)).toBe(false);
  });
});

describe('shouldRunSessionExchange', () => {
  it('needs BOTH ready and authenticated', () => {
    expect(shouldRunSessionExchange({ ready: true, authenticated: true })).toBe(true);
    expect(shouldRunSessionExchange({ ready: true, authenticated: false })).toBe(false);
    expect(shouldRunSessionExchange({ ready: false, authenticated: true })).toBe(false);
    expect(shouldRunSessionExchange({})).toBe(false);
    expect(shouldRunSessionExchange()).toBe(false);
  });
});

describe('runPrivySessionExchange', () => {
  it('a guest (getAccessToken -> null) NEVER calls the session route', async () => {
    const privySession = vi.fn();
    const setToken = vi.fn();
    const r = await runPrivySessionExchange({ getAccessToken: async () => null, privySession, setToken });
    expect(r).toEqual({ exchanged: false, reason: 'no-token' });
    expect(privySession).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it('auth user: exchanges the privy token for our JWT and sets it', async () => {
    const getAccessToken = vi.fn(async () => 'privy-token');
    const privySession = vi.fn(async () => ({ token: 'our-jwt', user: { id: 1, just_created: true } }));
    const setToken = vi.fn();
    const r = await runPrivySessionExchange({ getAccessToken, privySession, setToken });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(privySession).toHaveBeenCalledWith('privy-token');
    expect(setToken).toHaveBeenCalledWith('our-jwt');
    expect(r.exchanged).toBe(true);
    expect(r.token).toBe('our-jwt');
    expect(r.just_created).toBe(true);
    expect(r.user.id).toBe(1);
  });

  it('a session response with no our-JWT is an honest no-op', async () => {
    const setToken = vi.fn();
    const r = await runPrivySessionExchange({
      getAccessToken: async () => 't',
      privySession: async () => ({ user: {} }),
      setToken,
    });
    expect(r.exchanged).toBe(false);
    expect(r.reason).toBe('no-session-token');
    expect(setToken).not.toHaveBeenCalled();
  });

  it('a returning user (no just_created flag) yields just_created=false', async () => {
    const r = await runPrivySessionExchange({
      getAccessToken: async () => 't',
      privySession: async () => ({ token: 'jwt', user: { id: 2 } }),
      setToken: () => {},
    });
    expect(r.exchanged).toBe(true);
    expect(r.just_created).toBe(false);
  });

  it('a null/undefined session response is an honest no-op (never throws)', async () => {
    const r = await runPrivySessionExchange({ getAccessToken: async () => 't', privySession: async () => null, setToken: () => {} });
    expect(r.exchanged).toBe(false);
    expect(r.response).toBeNull();
  });
});

describe('resolveSigner - deliverable 4 SPIKE GATE', () => {
  const guest = { publicKey: 'G', secretKey: new Uint8Array(64) };
  const embedded = { address: 'E', getProvider: () => ({ request: () => {} }) };

  it('falls back to the guest keypair while signing is UNVERIFIED (default)', () => {
    expect(EMBEDDED_SIGNING_VERIFIED).toBe(false);
    expect(resolveSigner({ embeddedWallet: embedded, guestWallet: guest }).kind).toBe('guest');
  });

  it('uses the embedded wallet only when explicitly enabled AND present', () => {
    expect(resolveSigner({ embeddedWallet: embedded, guestWallet: guest, embeddedSigningEnabled: true }).kind).toBe('embedded');
  });

  it('enabled but no embedded wallet -> guest fallback', () => {
    expect(resolveSigner({ embeddedWallet: null, guestWallet: guest, embeddedSigningEnabled: true }).kind).toBe('guest');
  });

  it('enabled but a wallet with no provider/address -> guest fallback', () => {
    expect(resolveSigner({ embeddedWallet: { address: 'E' }, guestWallet: guest, embeddedSigningEnabled: true }).kind).toBe('guest');
    expect(resolveSigner({ embeddedWallet: { getProvider: () => ({}) }, guestWallet: guest, embeddedSigningEnabled: true }).kind).toBe('guest');
  });

  it('no args at all -> guest (never throws)', () => {
    expect(resolveSigner().kind).toBe('guest');
  });
});

describe('isJustCreated', () => {
  it('true only when user.just_created is truthy', () => {
    expect(isJustCreated({ just_created: true })).toBe(true);
    expect(isJustCreated({ just_created: false })).toBe(false);
    expect(isJustCreated(null)).toBe(false);
    expect(isJustCreated(undefined)).toBe(false);
  });
});