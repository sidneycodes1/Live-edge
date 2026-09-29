import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PantaError } from '../panta/errors.js';
import { validate } from '../middleware/validate.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const nonceSchema = z.object({ wallet: z.string().min(32).max(64) });
const verifySchema = z.object({ wallet: z.string().min(32).max(64), signature: z.string().min(10) });
const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  wallet: z.string().min(32).max(64),
});
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
const upgradeSchema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200) });

// A fixed dummy hash so a login for an unknown email still runs scrypt once —
// keeps response time for "no such account" identical to "wrong password".
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function publicUser(u) {
  return { id: u.id, wallet: u.wallet, email: u.email ?? null, kind: u.kind ?? 'guest', display_name: u.display_name };
}

function isValidBase58(s) {
  try {
    const decoded = bs58.decode(s);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function authRouter({ db, env, auth, notify }) {
  const r = Router();

  r.post('/nonce', validate(nonceSchema), async (req, res, next) => {
    try {
      const { wallet } = req.body;
      if (!isValidBase58(wallet)) {
        throw new PantaError('VALIDATION_ERROR', 'Invalid wallet address', { status: 400 });
      }
      const nonce = randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await db.query(
        `insert into auth_nonces(wallet, nonce, expires_at) values($1,$2,$3)
         on conflict (wallet) do update set nonce=$2, expires_at=$3`,
        [wallet, nonce, expiresAt],
      );
      const message = `LiveEdge sign-in\nWallet: ${wallet}\nNonce: ${nonce}`;
      res.json({ nonce, message, expiresAt });
    } catch (e) {
      next(e);
    }
  });

  r.post('/verify', validate(verifySchema), async (req, res, next) => {
    try {
      const { wallet, signature } = req.body;
      const { rows } = await db.query('select * from auth_nonces where wallet=$1', [wallet]);
      if (rows.length === 0) throw new PantaError('UNAUTHORIZED', 'Nonce not found or expired', { status: 401 });
      const rec = rows[0];
      if (new Date(rec.expires_at) <= new Date()) {
        await db.query('delete from auth_nonces where wallet=$1', [wallet]);
        throw new PantaError('UNAUTHORIZED', 'Nonce expired', { status: 401 });
      }
      const message = `LiveEdge sign-in\nWallet: ${wallet}\nNonce: ${rec.nonce}`;
      const msgBytes = new TextEncoder().encode(message);
      let sigBytes, pubBytes;
      try {
        sigBytes = bs58.decode(signature);
        pubBytes = bs58.decode(wallet);
      } catch {
        throw new PantaError('UNAUTHORIZED', 'Invalid signature encoding', { status: 401 });
      }
      const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
      if (!valid) throw new PantaError('UNAUTHORIZED', 'Invalid signature', { status: 401 });
      await db.query('delete from auth_nonces where wallet=$1', [wallet]);
      // upsert user
      let userId;
      const { rows: uRows } = await db.query('select * from users where wallet=$1', [wallet]);
      if (uRows.length === 0) {
        const id = randomUUID();
        await db.query('insert into users(id, wallet, display_name) values($1,$2,$3)', [id, wallet, wallet.slice(0, 4) + '…' + wallet.slice(-4)]);
        await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [id]);
        userId = id;
        if (notify) await notify({ userId: id, kind: 'welcome', body: "Welcome! You've received $100 in play money" });
      } else {
        userId = uRows[0].id;
        // ensure balance exists
        await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [userId]);
      }
      const { rows: finalU } = await db.query('select * from users where id=$1', [userId]);
      const user = finalU[0];
      const token = jwt.sign({ id: user.id, wallet: user.wallet }, env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: { id: user.id, wallet: user.wallet, display_name: user.display_name } });
    } catch (e) {
      next(e);
    }
  });

  // ---- Email/password accounts (F-004). Layered on top of the guest wallet ----
  // path above; both share the same `users` table. The Ed25519 wallet is still
  // what signs claims/orders — email/password is an additional auth + recovery
  // identity, not a replacement for the signing keypair.

  r.post('/register', validate(registerSchema), async (req, res, next) => {
    try {
      const { password } = req.body;
      const email = normalizeEmail(req.body.email);
      const { wallet } = req.body;
      if (!isValidBase58(wallet)) {
        throw new PantaError('VALIDATION_ERROR', 'Invalid wallet address', { status: 400 });
      }
      // email must be globally free (case-insensitive)
      const { rows: emailHit } = await db.query('select id from users where lower(email)=$1', [email]);
      if (emailHit.length > 0) {
        throw new PantaError('EMAIL_EXISTS', 'An account with this email already exists', { status: 409 });
      }
      const password_hash = await hashPassword(password);
      // does this wallet already belong to an account?
      const { rows: walletHit } = await db.query('select * from users where wallet=$1', [wallet]);
      let user;
      if (walletHit.length > 0) {
        const existing = walletHit[0];
        if (existing.email) {
          throw new PantaError('WALLET_IN_USE', 'This wallet is already linked to another account', { status: 409 });
        }
        // Upgrade an existing guest wallet in place: same id, balance and positions
        // are untouched — we only attach identity columns.
        await db.query(`update users set email=$1, password_hash=$2, kind='email', upgraded_at=now() where id=$3`, [email, password_hash, existing.id]);
        await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [existing.id]);
        const { rows: refreshed } = await db.query('select * from users where id=$1', [existing.id]);
        user = refreshed[0];
        if (notify) await notify({ userId: existing.id, kind: 'account_upgraded', body: 'Your account now has email & password sign-in' });
      } else {
        const id = randomUUID();
        await db.query(`insert into users(id, wallet, display_name, email, password_hash, kind, upgraded_at) values($1,$2,$3,$4,$5,'email',now())`, [
          id,
          wallet,
          wallet.slice(0, 4) + '…' + wallet.slice(-4),
          email,
          password_hash,
        ]);
        await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [id]);
        const { rows: created } = await db.query('select * from users where id=$1', [id]);
        user = created[0];
        if (notify) await notify({ userId: id, kind: 'welcome', body: 'Welcome! Your account is ready with $100 in play money' });
      }
      const token = jwt.sign({ id: user.id, wallet: user.wallet }, env.JWT_SECRET, { expiresIn: '1h' });
      res.status(201).json({ token, user: publicUser(user) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/login', validate(loginSchema), async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const { password } = req.body;
      const { rows } = await db.query('select * from users where lower(email)=$1', [email]);
      // Always run one scrypt verification to equalize timing whether or not the
      // account exists (avoids user-enumeration via response-time differences).
      const stored = rows.length > 0 ? rows[0].password_hash : DUMMY_HASH;
      const ok = await verifyPassword(password, stored);
      if (rows.length === 0 || !ok || !rows[0].password_hash) {
        throw new PantaError('INVALID_CREDENTIALS', 'Invalid email or password', { status: 401 });
      }
      const user = rows[0];
      await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [user.id]);
      const token = jwt.sign({ id: user.id, wallet: user.wallet }, env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: publicUser(user) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/me', auth, async (req, res, next) => {
    try {
      const { rows } = await db.query('select * from users where id=$1', [req.user.id]);
      if (rows.length === 0) throw new PantaError('UNAUTHORIZED', 'User not found', { status: 401 });
      res.json({ user: publicUser(rows[0]) });
    } catch (e) {
      next(e);
    }
  });

  // Logout is intentionally a client-side token clear. JWTs here are stateless
  // and short-lived (1h expiry, no refresh), so there is no server session to
  // destroy. Server-side revocation would require a blocklist or token store, which
  // we deliberately did NOT add this pass — see report §2.1. The endpoint exists so
  // the client has a single place to call and so a future blocklist can slot in here.
  r.post('/logout', auth, (_req, res) => {
    res.json({ ok: true });
  });

  r.post('/upgrade', auth, validate(upgradeSchema), async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const { password } = req.body;
      const { rows: mine } = await db.query('select * from users where id=$1', [req.user.id]);
      if (mine.length === 0) throw new PantaError('UNAUTHORIZED', 'User not found', { status: 401 });
      const me = mine[0];
      if (me.kind === 'email' || me.email) {
        throw new PantaError('ALREADY_UPGRADED', 'This account already has an email attached', { status: 409 });
      }
      const { rows: emailHit } = await db.query('select id from users where lower(email)=$1', [email]);
      if (emailHit.length > 0) {
        throw new PantaError('EMAIL_EXISTS', 'An account with this email already exists', { status: 409 });
      }
      const password_hash = await hashPassword(password);
      await db.query(`update users set email=$1, password_hash=$2, kind='email', upgraded_at=now() where id=$3`, [email, password_hash, me.id]);
      const { rows: refreshed } = await db.query('select * from users where id=$1', [me.id]);
      const user = refreshed[0];
      if (notify) await notify({ userId: user.id, kind: 'account_upgraded', body: 'Your account now has email & password sign-in' });
      const token = jwt.sign({ id: user.id, wallet: user.wallet }, env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: publicUser(user) });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
