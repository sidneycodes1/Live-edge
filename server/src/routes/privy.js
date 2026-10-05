import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PantaError } from '../panta/errors.js';
import { validate } from '../middleware/validate.js';
import { publicUser } from './auth.js';

const sessionSchema = z.object({ privyToken: z.string().min(1).max(8192) });

// Privy session exchange — POST /api/auth/privy/session (PUBLIC: no auth middleware).
// Mounts as a fall-through on the /api/auth prefix alongside authRouter, so it
// inherits the same limiter wiring from app.js.
//
// Identity resolution, in the spec's exact order (docs/PRIVY_AUTH_SPEC.md §API 1):
//   (a) privy_did already known           → sign that user in (just_created=false)
//   (b) valid LiveEdge guest JWT present   → attach the did to THAT account (upgrade;
//                                            balance + live_pins rows survive — same id)
//   (c) brand-new                          → create the user, wallet = embedded Solana
//                                            (bs58) address; if none → honest 401 (D1)
//
// The Privy verifier is INJECTED (verifyPrivyToken) so hermetic tests pass a fake and
// no live network is touched. Absent creds → verifyPrivyToken is null → 503, never a
// crash. This mirrors every other optional provider's degrade policy.
export function privyRouter({ db, env, verifyPrivyToken, notify }) {
  const r = Router();

  r.post('/privy/session', validate(sessionSchema), async (req, res, next) => {
    try {
      if (!verifyPrivyToken) {
        throw new PantaError('PRIVY_DISABLED', 'Privy auth is not configured on this server', { status: 503 });
      }
      const { privyToken } = req.body;

      let verified;
      try {
        verified = await verifyPrivyToken(privyToken);
      } catch {
        // A thrown/undefined result from the verifier is strictly an auth failure:
        // never leak the SDK's message, and never fall through to user creation.
        throw new PantaError('UNAUTHORIZED', 'Invalid or expired Privy token', { status: 401 });
      }
      const did = verified && verified.did;
      const solanaAddress = verified && verified.solanaAddress;
      if (!did) throw new PantaError('UNAUTHORIZED', 'Invalid or expired Privy token', { status: 401 });

      let user;
      let justCreated = false;

      // (a) known DID → sign in.
      const { rows: byDid } = await db.query('select * from users where privy_did=$1', [did]);
      if (byDid.length > 0) {
        user = byDid[0];
      } else {
        // (b) optional LiveEdge guest JWT in the Authorization header → upgrade in place.
        const guest = await resolveGuestUser(req, env, db);
        if (guest) {
          await db.query('update users set privy_did=$1 where id=$2', [did, guest.id]);
          const { rows: refreshed } = await db.query('select * from users where id=$1', [guest.id]);
          user = refreshed[0];
        } else {
          // (c) brand-new → requires the embedded Solana wallet (spec D1). No wallet →
          // honest 401 (we NEVER fabricate a keypair here; §2 honesty + spec line 106-108).
          if (!solanaAddress) {
            throw new PantaError('UNAUTHORIZED', 'Privy account has no embedded Solana wallet', { status: 401 });
          }
          const id = randomUUID();
          await db.query('insert into users(id, wallet, display_name, privy_did) values($1,$2,$3,$4)', [
            id,
            solanaAddress,
            solanaAddress.slice(0, 4) + '…' + solanaAddress.slice(-4),
            did,
          ]);
          await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [id]);
          // Journal the welcome mint ($100 play money) exactly like /auth/verify so the
          // ledger invariant holds for Privy-born accounts too.
          await db.query(`insert into mint_events(user_id, kind, amount) values($1,'welcome',100)`, [id]);
          const { rows: created } = await db.query('select * from users where id=$1', [id]);
          user = created[0];
          justCreated = true;
          if (notify) await notify({ userId: id, kind: 'welcome', body: "Welcome! You've received $100 in play money" });
        }
      }

      // Idempotent balance guard for paths (a)/(b) whose account may predate a balance row.
      await db.query('insert into balances(user_id, sim_usdc) values($1,100) on conflict do nothing', [user.id]);

      const token = jwt.sign({ id: user.id, wallet: user.wallet }, env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: { ...publicUser(user), just_created: justCreated } });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

// Reads an OPTIONAL LiveEdge JWT from the Authorization header. A missing/invalid
// token is not an error here — it just means "not the guest-upgrade path". Returns
// the matching user row, or null (including when the JWT's id no longer exists).
async function resolveGuestUser(req, env, db) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  let payload;
  try {
    payload = jwt.verify(h.slice(7), env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!payload || !payload.id) return null;
  const { rows } = await db.query('select * from users where id=$1', [payload.id]);
  return rows.length > 0 ? rows[0] : null;
}
