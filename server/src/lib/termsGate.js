import { PantaError } from '../panta/errors.js';

// Shared TERMS gate — the honest technical enforcement of docs/ONBOARDING_PLAN.md §4:
// a browse-only account may look at everything, but it may NOT place an order or claim
// a payout until it has accepted the Terms (terms_accepted_at IS NOT NULL, set by
// POST /api/me/setup). One helper so the rule lives in exactly one place.
//
// We query the single column rather than requiring the caller to have already loaded
// the user row: on the order/claim paths the users row is only fetched AFTER the money
// operation, so re-reading it first would reorder real logic for no benefit. A tiny
// indexed lookup by primary key here is cheap and keeps the call sites honest.
export async function assertTermsAccepted(db, userId) {
  const { rows } = await db.query('select terms_accepted_at from users where id=$1', [userId]);
  if (rows.length === 0) {
    throw new PantaError('UNAUTHORIZED', 'Unauthorized', { status: 401 });
  }
  if (!rows[0].terms_accepted_at) {
    throw new PantaError('TERMS_REQUIRED', 'You must accept the Terms before trading or claiming.', {
      status: 403,
    });
  }
}
