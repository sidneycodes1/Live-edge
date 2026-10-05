// ---------------------------------------------------------------------------
// Welcome / congrats logic — PURE + injectable so it is unit-testable with
// vitest (repo rule: pure logic in web/src/lib, no jsdom, no React).
// Contract: docs/PRIVY_AUTH_SPEC.md Amendments 2–3 + docs/ONBOARDING_PLAN.md
// §2–§4. No window, no fetch here: callers inject storage / read matchMedia.
// ---------------------------------------------------------------------------

export const WELCOME_LATCH_KEY = 'liveedge_welcome_shown';
export const TUNED_NOTE_KEY = 'liveedge_tuned_for';
export const BALANCE_MIRROR_KEY = 'liveedge_balance_countup';

// The funded amount is PLAY MONEY — always rendered with the mandatory
// play-money wording next to it (product law, spec "Honesty").
export const WELCOME_TARGET_USD = 100;
export const COUNTUP_DURATION_MS = 600;

// $X.XX — the exact surface format the congrats screen promises ("$100.00").
export function formatUsd(value) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `$${v.toFixed(2)}`;
}

// One frame of the count-up: maps elapsed time to a display string.
//   * reducedMotion (prefers-reduced-motion) or a non-positive duration →
//     STATIC fallback: always the final amount, no animation (spec: "static
//     under prefers-reduced-motion").
//   * easeOutCubic so the number "lands" on $100.00; clamped so it can never
//     overshoot, and exactly formatUsd(target) at/after the duration.
export function countUpFrame({
  elapsedMs = 0,
  durationMs = COUNTUP_DURATION_MS,
  target = WELCOME_TARGET_USD,
  reducedMotion = false,
} = {}) {
  if (reducedMotion || !(Number(durationMs) > 0)) return formatUsd(target);
  const t = Math.min(1, Math.max(0, Number(elapsedMs) / Number(durationMs)));
  if (!Number.isFinite(t)) return formatUsd(0);
  const eased = 1 - Math.pow(1 - t, 3);
  return formatUsd(target * eased);
}

// The full sequence (frames every `stepMs`, inclusive of the final frame) —
// used by tests to prove the 600ms/$100.00 contract and by the header-balance
// mirror so both surfaces animate identically.
export function countUpSequence({
  stepMs = 100,
  durationMs = COUNTUP_DURATION_MS,
  target = WELCOME_TARGET_USD,
  reducedMotion = false,
} = {}) {
  if (reducedMotion || !(Number(durationMs) > 0) || !(Number(stepMs) > 0)) {
    return [formatUsd(target)];
  }
  const out = [];
  for (let t = 0; t <= durationMs; t += Number(stepMs)) {
    out.push(countUpFrame({ elapsedMs: t, durationMs, target }));
  }
  const last = out[out.length - 1];
  if (last !== formatUsd(target)) out.push(formatUsd(target));
  return out;
}

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

// --- abandonment / resume (plan §2 "Abandonment path") ----------------------
// needsSetup gates the /welcome takeover: ONLY the server's explicit
// `setup_completed === false` drives it (never inferred client-side). The
// strict comparison also keeps the app un-hijacked while Agent A2's field has
// not shipped yet (undefined ⇒ no takeover) — remove-nothing, honest transition.
export function needsSetup(user) {
  return Boolean(user) && user.setup_completed === false;
}

// Shell redirect rule into the cover: explicit server "not completed" OR a
// brand-new session account (just_created) whose completion flag has not been
// proven true. covers the window where Agent A2's field is not shipped yet —
// a just_created account has NEVER completed setup, so entering /welcome is
// still server-driven truth, not a client-side guess.
export function shouldEnterWelcome(user) {
  if (!user) return false;
  if (user.setup_completed === true) return false;
  return user.setup_completed === false || user.just_created === true;
}

// First INCOMPLETE step, from server fields: no display name → 1; a name but
// no stored interests → 2 (skip writes all three, so empty ⇒ never visited);
// otherwise the terms/submit step 3. Steps are 1-based integers.
export function resumeStep(user) {
  if (!user || !user.display_name) return 1;
  const interests = Array.isArray(user.interests) ? user.interests.filter(Boolean) : [];
  if (interests.length === 0) return 2;
  return 3;
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

// Header balance-chip mirror: when the congrats screen is shown, the next
// HeaderBalance mount replays the SAME 600ms count-up on the chip (spec:
// "Header balance chip mirrors the count-up"). One-shot: consumed on arrival.
export function armBalanceMirror(storage) { safeSet(storage, BALANCE_MIRROR_KEY, '1'); }
export function consumeBalanceMirror(storage) {
  if (safeGet(storage, BALANCE_MIRROR_KEY) !== '1') return false;
  safeRemove(storage, BALANCE_MIRROR_KEY);
  return true;
}
