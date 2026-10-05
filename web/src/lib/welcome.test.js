import { describe, it, expect } from 'vitest';
import {
  formatUsd,
  countUpFrame,
  countUpSequence,
  greetingName,
  markWelcomeShown,
  isWelcomeLatched,
  shouldShowCongrats,
  needsSetup,
  shouldEnterWelcome,
  resumeStep,
  resumeFields,
  welcomePhase,
  validateDisplayName,
  setTunedNote,
  consumeTunedNote,
  armBalanceMirror,
  consumeBalanceMirror,
  WELCOME_LATCH_KEY,
  COUNTUP_DURATION_MS,
  WELCOME_TARGET_USD,
} from './welcome.js';

// Pure logic only (no jsdom, no React). sessionStorage is faked by injection.
const fakeStorage = (initial = {}) => {
  const map = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    _map: map,
  };
};

describe('formatUsd', () => {
  it('renders $X.XX and never NaN', () => {
    expect(formatUsd(100)).toBe('$100.00');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd('nope')).toBe('$0.00');
  });
});

describe('countUpFrame (600ms -> $100.00)', () => {
  it('starts at $0.00 and lands EXACTLY on $100.00 at the duration', () => {
    expect(countUpFrame({ elapsedMs: 0 })).toBe('$0.00');
    expect(countUpFrame({ elapsedMs: COUNTUP_DURATION_MS })).toBe('$100.00');
    expect(countUpFrame({ elapsedMs: COUNTUP_DURATION_MS + 5000 })).toBe('$100.00'); // clamped, never overshoots
  });
  it('increases monotonically mid-flight', () => {
    const a = Number(countUpFrame({ elapsedMs: 150 }).slice(1));
    const b = Number(countUpFrame({ elapsedMs: 300 }).slice(1));
    const c = Number(countUpFrame({ elapsedMs: 450 }).slice(1));
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(WELCOME_TARGET_USD);
  });
  it('reduced motion -> STATIC final amount (spec: no animation)', () => {
    expect(countUpFrame({ elapsedMs: 0, reducedMotion: true })).toBe('$100.00');
    expect(countUpFrame({ elapsedMs: 300, reducedMotion: true })).toBe('$100.00');
  });
  it('zero/negative duration is the static fallback too', () => {
    expect(countUpFrame({ elapsedMs: 0, durationMs: 0 })).toBe('$100.00');
  });
});

describe('countUpSequence', () => {
  it('covers 0..600ms and ends exactly at $100.00', () => {
    const seq = countUpSequence({ stepMs: 100 });
    expect(seq[0]).toBe('$0.00');
    expect(seq[seq.length - 1]).toBe('$100.00');
    expect(seq.length).toBeGreaterThanOrEqual(7); // 0,100,...,600
  });
  it('reduced motion collapses to one static frame', () => {
    expect(countUpSequence({ reducedMotion: true })).toEqual(['$100.00']);
  });
  it('garbage step/duration never throws and never loops', () => {
    expect(countUpSequence({ stepMs: 0 })).toEqual(['$100.00']);
    expect(countUpSequence({ durationMs: -5 })).toEqual(['$100.00']);
  });
});

describe('greetingName', () => {
  it('prefers display_name, then email local part, then "there"', () => {
    expect(greetingName({ display_name: 'Nova', email: 'a@b.co' })).toBe('Nova');
    expect(greetingName({ email: 'Nova.Fox@gmail.com' })).toBe('Nova.Fox');
    expect(greetingName({ display_name: '   ', email: 'x@y.z' })).toBe('x');
    expect(greetingName({})).toBe('there');
    expect(greetingName(null)).toBe('there');
  });
});

describe('welcome latch (once per session, server-flag driven)', () => {
  it('sessionStorage key matches the frozen contract name', () => {
    expect(WELCOME_LATCH_KEY).toBe('liveedge_welcome_shown');
  });
  it('mark + read round-trip through injected storage', () => {
    const s = fakeStorage();
    expect(isWelcomeLatched(s)).toBe(false);
    markWelcomeShown(s);
    expect(isWelcomeLatched(s)).toBe(true);
  });
  it('storage that throws (private mode) degrades honestly, never crashes', () => {
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    expect(isWelcomeLatched(bad)).toBe(false);
    expect(() => markWelcomeShown(bad)).not.toThrow();
  });
  it('shouldShowCongrats: just_created + setup_completed true, not latched', () => {
    expect(shouldShowCongrats({ just_created: true, setup_completed: true, latched: false })).toBe(true);
    expect(shouldShowCongrats({ just_created: true, setup_completed: true, latched: true })).toBe(false);
    expect(shouldShowCongrats({ just_created: true, setup_completed: false })).toBe(false); // resume path shows it after setup, not before
    expect(shouldShowCongrats({ just_created: false, setup_completed: true })).toBe(false); // returning users NEVER re-celebrate
    expect(shouldShowCongrats({ just_created: true, setup_completed: undefined })).toBe(false); // flag not shipped -> no moment
    expect(shouldShowCongrats()).toBe(false);
  });
});

describe('needsSetup / resumeStep (abandonment + resume, server field drives)', () => {
  it('only an explicit setup_completed === false takes over the app', () => {
    expect(needsSetup({ id: 1, setup_completed: false })).toBe(true);
    expect(needsSetup({ id: 1, setup_completed: true })).toBe(false);
    expect(needsSetup({ id: 1 })).toBe(false); // field absent (pre-A2 server) -> NEVER hijack
    expect(needsSetup(null)).toBe(false);
  });
  it('resume lands on the first incomplete step', () => {
    expect(resumeStep(null)).toBe(1);
    expect(resumeStep({ display_name: null })).toBe(1);
    expect(resumeStep({ display_name: 'Nova', interests: [] })).toBe(2);
    expect(resumeStep({ display_name: 'Nova', interests: ['sports'] })).toBe(3);
    expect(resumeStep({ display_name: 'Nova' })).toBe(2); // no interests field yet
  });
  it('does not count the server wallet placeholder as a chosen username', () => {
    // The server inserts display_name = wallet.slice(0,4) + '…' + wallet.slice(-4)
    // at account creation (auth.js / privy.js), so a BRAND-NEW account arrives with
    // a name already set. Step 1 is required (owner decision), and that placeholder
    // is rejected by the server's own display-name regex, so it must not skip it.
    expect(resumeStep({ display_name: 'EkPU…4XQF', interests: [] })).toBe(1);
    expect(resumeStep({ display_name: 'EkPU…4XQF', interests: ['sports'] })).toBe(1);
    expect(resumeStep({ display_name: '2rYi…Tzfa' })).toBe(1);
    expect(resumeStep({ display_name: 'a' })).toBe(1); // too short to be a real choice
  });
});

describe('welcomePhase (which screen the cover shows on arrival)', () => {
  it('the funded congrats moment wins first, exactly once', () => {
    expect(
      welcomePhase({ user: { just_created: true, setup_completed: true }, latched: false })
    ).toBe('congrats');
    // latched => already shown: a complete account must NOT be stranded in the cover
    expect(
      welcomePhase({ user: { just_created: true, setup_completed: true }, latched: true })
    ).toBe('home');
  });
  it('a server-complete account goes home, an incomplete one shows the steps', () => {
    expect(welcomePhase({ user: { setup_completed: true } })).toBe('home');
    expect(welcomePhase({ user: { setup_completed: false } })).toBe('steps');
    expect(welcomePhase({ user: {} })).toBe('steps'); // server truth not landed yet
    expect(welcomePhase({ user: null })).toBe('steps');
    expect(welcomePhase()).toBe('steps');
  });
});

describe('resumeFields (reconcile the cover once /api/auth/me lands)', () => {
  it('adopts stored fields when nothing was typed yet', () => {
    expect(resumeFields({ display_name: 'EkPU…4XQF', interests: [] })).toEqual({
      step: 1,
      displayName: '', // the wallet placeholder is not a chosen username
      interests: [],
    });
    expect(resumeFields({ display_name: 'Nova', interests: ['sports'] })).toEqual({
      step: 3,
      displayName: 'Nova',
      interests: ['sports'],
    });
    expect(resumeFields(null)).toEqual({ step: 1, displayName: '', interests: [] });
  });
  it('never overwrites typing and never moves the step backwards', () => {
    const r = resumeFields(
      { display_name: 'Nova', interests: ['sports'] },
      { step: 3, displayName: 'typed', interests: [] }
    );
    expect(r.displayName).toBe('typed'); // their input wins
    expect(r.interests).toEqual(['sports']); // nothing picked locally -> adopt server
    expect(r.step).toBe(3);
    // a late reconcile must not yank an in-progress user back to Step 1
    expect(resumeFields({ display_name: null }, { step: 2, displayName: 'abc', interests: [] }).step).toBe(2);
  });
});

describe('validateDisplayName (mirrors the server zod rule exactly)', () => {
  it('accepts valid handles', () => {
    for (const ok of ['ab', 'Nova_99', 'a.b-c_1', 'Xy', '12345678901234567890']) {
      expect(validateDisplayName(ok).valid).toBe(true);
    }
  });
  it('rejects too short / too long', () => {
    expect(validateDisplayName('a').valid).toBe(false);
    expect(validateDisplayName(''.padStart(21, 'a')).valid).toBe(false);
    expect(validateDisplayName('').valid).toBe(false);
  });
  it('rejects bad start/end and illegal characters (zod regex cases)', () => {
    for (const bad of ['_abc', 'abc_', '.abc', 'abc.', '-ab', 'ab-', 'a b', 'aa--', 'ünicode', 'ok!']) {
      expect(validateDisplayName(bad).valid).toBe(false);
    }
    // interior double separators are allowed by the regex ([a-zA-Z0-9._-]*):
    expect(validateDisplayName('a--b').valid).toBe(true);
  });
  it('non-strings never pass', () => {
    expect(validateDisplayName(undefined).valid).toBe(false);
    expect(validateDisplayName(42).valid).toBe(false);
  });
});

describe('tuned-note one-shot channel (Welcome -> Discover)', () => {
  it('set then consume returns the name ONCE and clears the key', () => {
    const s = fakeStorage();
    setTunedNote(s, 'Nova');
    expect(consumeTunedNote(s)).toBe('Nova');
    expect(consumeTunedNote(s)).toBeNull();
  });
  it('absent storage / empty value -> null, never throws', () => {
    expect(consumeTunedNote(null)).toBeNull();
    expect(consumeTunedNote(fakeStorage())).toBeNull();
  });
});

describe('shouldEnterWelcome (cover-route takeover incl. pre-A2 window)', () => {
  it('explicit setup_completed=false OR a just_created account enters /welcome', () => {
    expect(shouldEnterWelcome({ setup_completed: false })).toBe(true);
    expect(shouldEnterWelcome({ just_created: true, setup_completed: undefined })).toBe(true);
    expect(shouldEnterWelcome({ just_created: true })).toBe(true);
  });
  it('completed setup NEVER re-enters, even with a stale just_created flag', () => {
    expect(shouldEnterWelcome({ setup_completed: true, just_created: true })).toBe(false);
    expect(shouldEnterWelcome({ setup_completed: true })).toBe(false);
  });
  it('established users without the field (pre-A2 server) are not hijacked', () => {
    expect(shouldEnterWelcome({ id: 7 })).toBe(false);
    expect(shouldEnterWelcome(null)).toBe(false);
  });
});

describe('balance-chip mirror one-shot (Welcome -> HeaderBalance)', () => {
  it('arm + consume returns true ONCE', () => {
    const s = fakeStorage();
    expect(consumeBalanceMirror(s)).toBe(false);
    armBalanceMirror(s);
    expect(consumeBalanceMirror(s)).toBe(true);
    expect(consumeBalanceMirror(s)).toBe(false);
  });
  it('hostile/absent storage degrades honestly', () => {
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    expect(() => armBalanceMirror(bad)).not.toThrow();
    expect(consumeBalanceMirror(bad)).toBe(false);
    expect(consumeBalanceMirror(null)).toBe(false);
  });
});
