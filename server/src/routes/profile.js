import { Router } from 'express';
import { z } from 'zod';
import { PantaError } from '../panta/errors.js';
import { validate } from '../middleware/validate.js';
import { publicUser } from './auth.js';

// Display name: 2–20 chars, must start+end alnum, may contain . _ - in the middle
// (exact regex from docs/PRIVY_AUTH_SPEC.md §API 2).
const DISPLAY_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

// Interests are an honest, closed vocabulary of 0–3 UNIQUE values (spec: the feed
// re-ranks REAL cards by these tags and must never fabricate to fill one).
const profileSchema = z.object({
  displayName: z.string().regex(DISPLAY_NAME_RE, 'Invalid display name').min(2).max(20),
  interests: z
    .array(z.enum(['trading', 'sports', 'streams']))
    .max(3, 'At most 3 interests')
    .refine((arr) => new Set(arr).size === arr.length, { message: 'Interests must be unique' }),
});

// POST /api/me/setup reuses the SAME frozen displayName/interests rules as the PUT
// profile route, then adds the Terms consent fields (docs/ONBOARDING_PLAN.md §4): a
// non-empty termsVersion (<=40) and `accepted`, which must be the literal true — a
// missing/false/other value fails zod -> 400, so nothing is ever written.
const setupSchema = profileSchema.extend({
  termsVersion: z.string().min(1, 'termsVersion required').max(40),
  accepted: z.literal(true),
});

// PUT /api/me/profile — AUTH (mounted behind `auth` in app.js). Writes the display
// name + interests the onboarding flow collects and returns the updated publicUser
// (which now carries interests + privy_linked, per the spec).
export function profileRouter({ db }) {
  const r = Router();

  r.put('/profile', validate(profileSchema), async (req, res, next) => {
    try {
      const { displayName, interests } = req.body;
      const { rows: mine } = await db.query('select * from users where id=$1', [req.user.id]);
      if (mine.length === 0) throw new PantaError('UNAUTHORIZED', 'User not found', { status: 401 });

      await db.query('update users set display_name=$1, interests=$2::jsonb where id=$3', [
        displayName,
        JSON.stringify(interests),
        req.user.id,
      ]);
      const { rows: updated } = await db.query('select * from users where id=$1', [req.user.id]);
      res.json({ user: publicUser(updated[0]) });
    } catch (e) {
      next(e);
    }
  });

  // ONE atomic shot: the profile write + the Terms consent + the setup-completed
  // marker all land together. A single UPDATE ... RETURNING is atomic on its own, so
  // there is no partial-completion window (a rejected payload never reaches here).
  r.post('/setup', validate(setupSchema), async (req, res, next) => {
    try {
      const { displayName, interests, termsVersion } = req.body;
      const { rows: updated } = await db.query(
        `update users
            set display_name=$1,
                interests=$2::jsonb,
                terms_version=$3,
                terms_accepted_at=now(),
                setup_completed_at=now()
          where id=$4
          returning *`,
        [displayName, JSON.stringify(interests), termsVersion, req.user.id],
      );
      if (updated.length === 0) throw new PantaError('UNAUTHORIZED', 'User not found', { status: 401 });
      res.json({ user: publicUser(updated[0]) });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
