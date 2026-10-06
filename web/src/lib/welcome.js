// ---------------------------------------------------------------------------
// Welcome / congrats logic — PURE + injectable so it is unit-testable with
// vitest (repo rule: pure logic in web/src/lib, no jsdom, no React).
// Contract: docs/PRIVY_AUTH_SPEC.md Amendments 2–3 + docs/ONBOARDING_PLAN.md
// §2–§4. No window, no fetch here: callers inject storage / read matchMedia.
// ---------------------------------------------------------------------------

export const WELCOME_LATCH_KEY = 'liveedge_welcome_shown';
export const TUNED_NOTE_KEY = 'liveedge_tuned_for';

// Greeting name (spec: display name → email local part → "there"). Never a
// fabricated handle: every fallback is derived from a real stored field.
export function greetingName(user) {
  const dn = user && user.display_name;
  if (typeof dn === 'string' && dn.trim()) return dn.trim();
  const email = user && user.email;
  if (typeof email === 'string' && email.includes('@')) {
    const local = email.split('@')[0].trim();
    if (local) return local;
  }
  return 'there';
}

// --- once-only latch -------------------------------------------------------
// sessionStorage latch: the congrats moment never repeats in a tab, and (with
// the server's setup_completed flag) never repeats across tabs either. The
// storage object is injected so tests run without a browser.
function safeGet(storage, key) {
  try { return storage && storage.getItem(key); } catch { return null; }
}
function safeSet(storage, key, value) {
  try { if (storage) storage.setItem(key, value); } catch { /* private mode: latch degrades to per-render, never throws */ }
}
function safeRemove(storage, key) {
  try { if (storage) storage.removeItem(key); } catch { /* see above */ }
}

export function markWelcomeShown(storage) { safeSet(storage, WELCOME_LATCH_KEY, '1'); }
export function isWelcomeLatched(storage) { return safeGet(storage, WELCOME_LATCH_KEY) === '1'; }

// Congrats rule (ONBOARDING_PLAN §4 "Welcome latch"): shows when the account
// was created by THIS session's Privy exchange (`just_created`) or right after
// setup completes — and NEVER twice (latch). `setup_completed === true` is the
// server truth (publicUser field from Agent A2's /api/me/setup); undefined is
// treated as "flag not available yet" and does NOT trigger the moment (an
// honest no-show beats a repeat/fabricated celebration).
export function shouldShowCongrats({ just_created, setup_completed, latched } = {}) {
  if (latched) return false;
  if (!just_created) return false;
  return setup_completed === true;
}

// Which screen the /welcome cover shows on arrival. The funded moment wins
// first (it is owed exactly once). After that, a server-CONFIRMED-complete
// account has nothing left to set up: it goes 'home' instead of being
// re-onboarded — /welcome stays reachable by reload, bookmark or the back
// button, and re-showing the required-username step there would strand a
// finished account inside the takeover. Anything else (incl. "server truth not
// known yet") shows the steps.
export function welcomePhase({ user, latched } = {}) {
  if (
    shouldShowCongrats({
      just_created: user?.just_created,
      setup_completed: user?.setup_completed,
      latched,
    })
  ) {
    return 'congrats';
  }
  return user && user.setup_completed === true ? 'home' : 'steps';
}

// --- abandonment / resume (plan §2 "Abandonment path") ----------------------
// needsSetup gates the /welcome takeover: ONLY the server's explicit
// `setup_completed === false` drives it (never inferred client-side). The
// strict comparison also keeps the app un-hijacked while Agent A2's field has
// not shipped yet (undefined ⇒ no takeover) — remove-nothing, honest transition.
export function needsSetup(user) {
  return Boolean(user) && user.setup_completed === false;
}

// --- landing gate (owner decision, Oct 2026) --------------------------------
// The live feed (Discover) is the landing page — onboarding NEVER hijacks an
// account out from under it; it is a dismissible OVERLAY (see Welcome.jsx).
// Two honest, server-field-driven rules:
//   * shouldAutoEnterWelcome: ONLY a brand-new session account (just_created,
//     completion not yet proven true) is walked into the onboarding overlay
//     automatically — the flow it just signed up for. It opens once; closing it
//     does not re-force it (App tracks that with a per-mount ref).
//   * canResumeWelcome: ANY signed-in account the server reports as unfinished
//     (setup_completed === false) gets the dismissible resume bar back into the
//     overlay. This intentionally also covers a just_created account that has
//     already dismissed its one auto-open, so the path back is never lost.
export function shouldAutoEnterWelcome(user) {
  if (!user) return false;
  if (user.just_created !== true) return false;
  return user.setup_completed !== true;
}

export function canResumeWelcome(user) {
  return needsSetup(user);
}

// First INCOMPLETE step, from server fields: no VALID display name → 1; a name
// but no stored interests → 2 (skip writes all three, so empty ⇒ never visited);
// otherwise the terms/submit step 3. Steps are 1-based integers.
//
// Step 1 is REQUIRED (owner decision: "username is required, no Skip"), so the
// test is VALIDITY, not presence: a brand-new account already carries the
// server's wallet-derived placeholder ("EkPU…4XQF", auth.js / privy.js), and
// that placeholder contains U+2026, which the server's own display-name regex
// rejects. Treating it as "username chosen" would silently skip the required
// step for every fresh account.
export function resumeStep(user) {
  if (!user || !validateDisplayName(user.display_name).valid) return 1;
  const interests = Array.isArray(user.interests) ? user.interests.filter(Boolean) : [];
  if (interests.length === 0) return 2;
  return 3;
}

// What the cover adopts from the server once /api/auth/me has landed (useAuth
// decodes the JWT optimistically first, so the initializers above cannot see
// these fields on the very first paint). `keep` is the local state the user may
// already have edited: their typing always wins, and the step only ever moves
// FORWARD — a late reconcile must not yank someone back to Step 1 mid-flow.
export function resumeFields(user, keep = {}) {
  const storedName = validateDisplayName(user?.display_name).valid ? user.display_name : '';
  const storedInterests = Array.isArray(user?.interests) ? user.interests.filter(Boolean) : [];
  const keepInterests = Array.isArray(keep.interests) ? keep.interests.filter(Boolean) : [];
  return {
    step: Math.max(Number(keep.step) || 1, resumeStep(user)),
    displayName: keep.displayName || storedName,
    interests: keepInterests.length ? keepInterests : storedInterests,
  };
}

// --- display-name validation ------------------------------------------------
// Mirrors the server zod rule EXACTLY (spec API contract 2 / profile.js):
// 2–20 chars, ^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$ — start+end
// alphanumeric, may contain . _ - inside. The SERVER stays the authority;
// this only mirrors the message so the user fixes it before submitting.
export const DISPLAY_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

export function validateDisplayName(value) {
  const s = typeof value === 'string' ? value : '';
  if (s.length < 2 || s.length > 20) {
    return { valid: false, message: 'Must be 2–20 characters.' };
  }
  if (!DISPLAY_NAME_RE.test(s)) {
    return { valid: false, message: 'Letters, numbers and . _ - only; must start and end with a letter or number.' };
  }
  return { valid: true, message: '' };
}

// --- "Tuned for {name}" one-shot note (plan §2 last line) -------------------
// Written by the Welcome flow after a successful setup, consumed ONCE by
// Discover so it shows exactly after the tuning actually happened.
export function setTunedNote(storage, name) { safeSet(storage, TUNED_NOTE_KEY, String(name || '')); }
export function consumeTunedNote(storage) {
  const raw = safeGet(storage, TUNED_NOTE_KEY);
  if (raw == null || raw === '') return null;
  safeRemove(storage, TUNED_NOTE_KEY);
  return raw;
}

