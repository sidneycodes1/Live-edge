import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PantaError } from '../panta/errors.js';
import { validate } from '../middleware/validate.js';

const nonceSchema = z.object({ wallet: z.string().min(32).max(64) });
const verifySchema = z.object({ wallet: z.string().min(32).max(64), signature: z.string().min(10) });

function isValidBase58(s) {
  try {
    const decoded = bs58.decode(s);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function authRouter({ db, env }) {
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

  return r;
}
