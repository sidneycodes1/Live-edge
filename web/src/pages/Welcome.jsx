import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import InterestChips, { ALL_INTERESTS } from '../components/InterestChips.jsx';
import { IconPlay } from '../components/Icons.jsx';
import {
  TERMS_SUMMARY_PARAGRAPH,
  TERMS_CHECKBOX_LABEL,
  TERMS_VERSION,
  FUNDED_LINE,
  PLAY_MONEY_LINE,
} from '../lib/terms.js';
import {
  validateDisplayName,
  resumeStep,
  resumeFields,
  welcomePhase,
  shouldShowCongrats,
  isWelcomeLatched,
  markWelcomeShown,
  setTunedNote,
  armBalanceMirror,
  countUpFrame,
  formatUsd,
  COUNTUP_DURATION_MS,
  WELCOME_TARGET_USD,
} from '../lib/welcome.js';

// ---------------------------------------------------------------------------
// /welcome — the full-screen account cover flow (docs/ONBOARDING_PLAN.md §2).
// No TopNav/BottomTabs (the App Shell renders this route alone). Three steps,
// always labelled "Step x of 3":
//   1. USERNAME   required, inline validation mirroring the server zod rule.
//   2. INTERESTS  three chips, skippable (skip selects all three so resume
//                 never re-visits an empty shelf), Back works.
//   3. TERMS      the exact TERMS_DRAFT Part-3 paragraph + 18+/agree checkbox;
//                 [Create my account] stays disabled until it is checked, then
//                 POSTs /api/me/setup (Agent A2's contract, plan §4).
// Success AND a just_created resume land on the congrats screen: a 600ms
// $0.00→$100.00 count-up (static under prefers-reduced-motion), mandatory
// play-money wording, and [Make your first prediction] into the feed.
// Desktop ≥1024px: two columns (brand + step rail left, 480px panel right).
// Mobile: one column with the primary CTA sticky at the bottom thumb zone.
// ---------------------------------------------------------------------------

const STEPS = [
  { n: 1, title: 'Choose a username' },
  { n: 2, title: 'Pick your interests' },
  { n: 3, title: 'Accept the terms' },
];

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// The funded moment. Count-up math is the tested pure fn (lib/welcome.js);
// this component only drives rAF frames and marks the once-only latch.
function Congrats() {
  const navigate = useNavigate();
  const reduced = useRef(prefersReducedMotion());
  const [frame, setFrame] = useState(() => (reduced.current ? formatUsd(WELCOME_TARGET_USD) : '$0.00'));

  useEffect(() => {
    markWelcomeShown(window.sessionStorage); // never shows twice in this tab
    if (reduced.current) {
      setFrame(formatUsd(WELCOME_TARGET_USD));
      return undefined;
    }
    let raf = 0;
    const t0 = window.performance.now();
    const tick = (now) => {
      const elapsed = now - t0;
      setFrame(countUpFrame({ elapsedMs: elapsed, reducedMotion: reduced.current }));
      if (elapsed < COUNTUP_DURATION_MS) raf = window.requestAnimationFrame(tick);
      else setFrame(formatUsd(WELCOME_TARGET_USD)); // land EXACTLY on $100.00
    };
    raf = window.requestAnimationFrame(tick);
    // rAF is suspended in a backgrounded tab, which would strand the promise on
    // "$0.00" forever — exactly the amount we told the user they have. A timer is
    // throttled but still fires there, so the final value is always reached.
    const land = window.setTimeout(
      () => setFrame(formatUsd(WELCOME_TARGET_USD)),
      COUNTUP_DURATION_MS + 120,
    );
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(land);
    };
  }, []);

  return (
    <div className="text-center py-6" data-testid="welcome-congrats">
      <p className="text-xs uppercase tracking-widest text-live font-bold">Welcome to LiveEdge</p>
      <p className="num font-heading font-bold text-6xl mt-6 tabular-nums" data-testid="congrats-countup" aria-live="polite">
        {frame}
      </p>
      <p className="text-lg font-semibold mt-4 leading-snug">{FUNDED_LINE}</p>
      <p className="inline-block mt-3 text-[11px] font-semibold uppercase tracking-wide bg-white/10 text-white/70 px-3 py-1 rounded-full">
        {PLAY_MONEY_LINE}
      </p>
      <button
        type="button"
        data-testid="first-prediction-cta"
        onClick={() => navigate('/', { state: { focusFirstCard: true } })}
        className="mt-8 w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-full bg-live text-white font-bold hover:brightness-110 transition cursor-pointer"
      >
        <IconPlay className="w-4 h-4" />
        Make your first prediction
      </button>
    </div>
  );
}

export default function Welcome() {
  const { user, loading, completeSetup, loginWithPrivy, privyAvailable } = useAuth();
  const [phase, setPhase] = useState(() =>
    welcomePhase({ user, latched: isWelcomeLatched(window.sessionStorage) }),
  );
  // Server fields drive the starting step (abandonment/resume, plan §2).
  const [step, setStep] = useState(() => resumeStep(user));
  // Never pre-fill the required username with the server's wallet-derived
  // placeholder ("EkPU…4XQF"): it is not a valid display name, so it would be
  // submittable-looking but rejected, and it undermines "choose your username".
  const [displayName, setDisplayName] = useState(() => resumeFields(user).displayName);
  const [nameTouched, setNameTouched] = useState(false);
  const [interests, setInterests] = useState(() => resumeFields(user).interests);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const nameRef = useRef(null);
  // useAuth decodes the JWT on mount and reconciles the identity fields
  // (display_name / interests / setup_completed) from /api/auth/me a tick later,
  // so the initializers above run WITHOUT them. These refs make the one-time
  // reconcile sync possible without clobbering typing or stealing the congrats.
  const serverSynced = useRef(false);
  const justSubmitted = useRef(false);

  const nameCheck = validateDisplayName(displayName);

  useEffect(() => {
    if (step === 1 && phase === 'steps') nameRef.current?.focus();
  }, [step, phase]);

  // A just_created account whose setup the server already confirmed (e.g. a
  // second mount of this route) goes straight to the one congrats screen.
  useEffect(() => {
    if (
      phase !== 'congrats' &&
      shouldShowCongrats({
        just_created: user?.just_created,
        setup_completed: user?.setup_completed,
        latched: isWelcomeLatched(window.sessionStorage),
      })
    ) {
      setPhase('congrats');
    }
  }, [user, phase]);

  // ---- adopt the server truth the moment it lands -------------------------
  // Without this, a reload of an UNFINISHED account restarted at Step 1 with
  // empty fields (the resume path never actually resumed), and a FINISHED
  // account arriving at /welcome by URL was re-onboarded inside the takeover.
  const serverKnown = Boolean(user) && user.setup_completed !== undefined;
  useEffect(() => {
    if (phase !== 'steps' || !serverKnown || serverSynced.current) return;
    serverSynced.current = true;
    if (justSubmitted.current) return; // the submit path owns the next screen
    if (user.setup_completed === true) {
      setPhase('home');
      return;
    }
    const synced = resumeFields(user, { step, displayName, interests });
    setStep(synced.step);
    setDisplayName(synced.displayName);
    setInterests(synced.interests);
  }, [serverKnown, phase, user, step, displayName, interests]);

  async function createAccount() {
    if (!nameCheck.valid || !accepted || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    justSubmitted.current = true; // this mount earned the congrats screen
    try {
      await completeSetup({
        displayName: displayName.trim(),
        interests,
        termsVersion: TERMS_VERSION,
        accepted: true,
      });
      // One-shot channels: the feed note + the header-chip count-up mirror.
      setTunedNote(window.sessionStorage, displayName.trim());
      armBalanceMirror(window.sessionStorage);
      setPhase('congrats');
    } catch (e) {
      // Honest failure: say it failed, keep everything they typed, let them retry.
      // A rejected payload (server status + code) carries a real message; a network
      // failure is a bare TypeError whose .message is the browser's own
      // "Failed to fetch" — never show that raw string to a user.
      setSubmitError(
        e?.status
          ? e.message || 'Could not create your account. Check the details and try again.'
          : 'Could not reach LiveEdge. Check your connection and try again — nothing was saved.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ---- states that are not the steps themselves ---------------------------
  // Setup is server-complete and no congrats is owed: hand the account back to
  // the app instead of showing it a cover it already finished.
  if (phase === 'home') return <Navigate to="/" replace />;
  if (phase === 'congrats') {
    return (
      <CoverShell step={null}>
        <Congrats />
      </CoverShell>
    );
  }
  if (!user) {
    // Login-or-nothing (Amendment 2): there is no guest setup. An unauthenticated
    // visitor who reaches /welcome gets the honest Privy prompt — and the public
    // feed stays browsable (logged-out browsing is allowed; setup is not).
    if (loading) return <CoverShell step={null}><p className="text-white/50 text-sm text-center py-10">Loading…</p></CoverShell>;
    return (
      <CoverShell step={null}>
        <div className="text-center py-6" data-testid="welcome-signed-out">
          <h2 className="font-heading font-bold text-xl">Finish setting up</h2>
          <p className="text-sm text-white/60 mt-3 leading-relaxed">
            Account setup lives inside your sign-in. Sign in (email code or Google) and this
            flow picks up right where you left off.
          </p>
          {privyAvailable ? (
            <button
              type="button"
              data-testid="welcome-signin"
              onClick={() => loginWithPrivy()}
              className="mt-6 w-full min-h-[48px] rounded-full bg-live text-white font-bold hover:brightness-110 transition cursor-pointer"
            >
              Sign in to continue
            </button>
          ) : (
            <Link
              to="/signin"
              className="mt-6 block w-full min-h-[48px] leading-[48px] rounded-full bg-live text-white font-bold hover:brightness-110 transition"
              data-testid="welcome-signin"
            >
              Sign in to continue
            </Link>
          )}
          <Link to="/" className="inline-block mt-4 text-sm text-white/50 underline hover:text-white/80">
            Browse without an account
          </Link>
        </div>
      </CoverShell>
    );
  }

  // ---- the three steps ------------------------------------------------------
  const back = step > 1 ? () => setStep((s) => s - 1) : null;
  let body = null;
  let cta = null;

  if (step === 1) {
    body = (
      <div>
        <h2 className="font-heading font-bold text-xl">Choose a username</h2>
        <p className="text-sm text-white/60 mt-2">
          This is how other players see you on bets, rooms and chat. Required — it&apos;s your account&apos;s name.
        </p>
        <input
          ref={nameRef}
          value={displayName}
          onChange={(e) => { setDisplayName(e.target.value); setNameTouched(true); }}
          onBlur={() => setNameTouched(true)}
          maxLength={24}
          autoComplete="nickname"
          spellCheck={false}
          aria-label="Username"
          aria-invalid={nameTouched && !nameCheck.valid}
          data-testid="welcome-username"
          className="mt-4 w-full bg-surface border border-white/15 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-white/40"
          placeholder="e.g. Nova_99"
        />
        {nameTouched && !nameCheck.valid ? (
          <p className="text-xs text-no mt-2" data-testid="username-error">{nameCheck.message}</p>
        ) : (
          <p className="text-xs text-white/40 mt-2">2–20 characters. Letters, numbers and . _ - inside; must start and end with a letter or number.</p>
        )}
      </div>
    );
    cta = (
      <button
        type="button"
        disabled={!nameCheck.valid}
        onClick={() => setStep(2)}
        data-testid="welcome-continue-1"
        className="w-full min-h-[48px] rounded-full bg-live text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition cursor-pointer"
      >
        Continue
      </button>
    );
  } else if (step === 2) {
    body = (
      <div>
        <h2 className="font-heading font-bold text-xl">What should we lead with?</h2>
        <p className="text-sm text-white/60 mt-2">
          We re-order your Live now feed around these. Your pinned streams always stay first.
        </p>
        <div className="mt-5">
          <InterestChips value={interests} onChange={setInterests} />
        </div>
      </div>
    );
    cta = (
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => { setInterests(ALL_INTERESTS); setStep(3); }}
          data-testid="welcome-skip-2"
          className="flex-1 min-h-[48px] rounded-full border border-white/15 bg-white/5 text-white/75 font-semibold hover:bg-white/10 transition cursor-pointer"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => setStep(3)}
          data-testid="welcome-continue-2"
          className="flex-1 min-h-[48px] rounded-full bg-live text-white font-bold hover:brightness-110 transition cursor-pointer"
        >
          Continue
        </button>
      </div>
    );
  } else {
    body = (
      <div>
        <h2 className="font-heading font-bold text-xl">One paragraph before your $100 lands</h2>
        <p className="text-sm text-white/70 mt-3 leading-relaxed">{TERMS_SUMMARY_PARAGRAPH}</p>
        <Link to="/legal" className="inline-block text-sm text-live underline mt-2" data-testid="welcome-legal-link">
          Read the full Terms &amp; Conditions
        </Link>
        <label className="mt-5 flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            data-testid="welcome-terms-checkbox"
            className="mt-1 w-5 h-5 accent-live shrink-0"
          />
          <span className="text-sm leading-snug">{TERMS_CHECKBOX_LABEL}</span>
        </label>
        {submitError && (
          <p className="text-xs text-no mt-3" data-testid="welcome-setup-error">{submitError}</p>
        )}
      </div>
    );
    cta = (
      <button
        type="button"
        disabled={!accepted || !nameCheck.valid || submitting}
        onClick={createAccount}
        data-testid="welcome-create"
        className="w-full min-h-[48px] rounded-full bg-live text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition cursor-pointer"
      >
        {submitting ? 'Creating…' : 'Create my account'}
      </button>
    );
  }

  return (
    <CoverShell step={step} back={back}>
      {body}
      {/* Mobile: the CTA sits in a sticky bottom bar (thumb zone, pb-safe);
          lg: resets it back into plain flow for the desktop side panel. */}
      <div className="sticky bottom-0 z-20 mt-8 -mx-4 px-4 pt-3 pb-3 pb-safe bg-bg/95 backdrop-blur border-t border-white/10 lg:static lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent lg:border-0">
        {cta}
      </div>
    </CoverShell>
  );
}

// Layout frame shared by every phase: ≥1024px two columns (brand + step rail
// left, 480px panel right), single column below with the CTA inside a sticky
// bottom bar. `step === null` hides the progress chrome (congrats/signed-out).
function CoverShell({ step, back, children }) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-bg">
      {/* Left brand panel — desktop only, per the frozen layout */}
      <aside className="hidden lg:flex w-1/2 flex-col justify-between p-10 border-r border-white/10">
        <div>
          <p className="font-heading font-bold text-2xl">LiveEdge</p>
          <p className="text-sm text-white/55 mt-2 max-w-sm leading-relaxed">
            Watch live streams and matches with friends — and bet play money on what happens next.
          </p>
        </div>
        <nav aria-label="Setup progress" className="space-y-3">
          {STEPS.map((s) => {
            const state = step == null ? 'todo' : s.n < step ? 'done' : s.n === step ? 'now' : 'todo';
            return (
              <div key={s.n} className="flex items-center gap-3" data-testid={`rail-step-${s.n}`}>
                <span
                  className={`w-7 h-7 shrink-0 grid place-items-center rounded-full border text-xs font-bold ${
                    state === 'now' ? 'bg-live border-live text-white' : state === 'done' ? 'border-live text-live' : 'border-white/25 text-white/40'
                  }`}
                >
                  {state === 'done' ? '·' : s.n}
                </span>
                <span className={`text-sm ${state === 'todo' ? 'text-white/40' : 'text-white/85'}`}>{s.title}</span>
              </div>
            );
          })}
        </nav>
        <p className="text-[11px] text-white/35 max-w-sm">{PLAY_MONEY_LINE}</p>
      </aside>

      <main className="flex-1 flex items-center justify-center px-4 py-6 lg:py-10">
        <div className="w-full max-w-[480px] flex flex-col">
          {/* Mobile header strip: brand + progress + Back */}
          <div className="lg:hidden flex items-center gap-3 mb-6 min-h-[44px]">
            <p className="font-heading font-bold text-lg shrink-0">LiveEdge</p>
            {step != null && (
              <>
                <span className="text-xs text-white/55 ml-auto" data-testid="step-indicator">Step {step} of 3</span>
                {back && (
                  <button
                    type="button"
                    onClick={back}
                    data-testid="welcome-back"
                    className="min-h-[44px] min-w-[64px] rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/75 cursor-pointer"
                  >
                    ← Back
                  </button>
                )}
              </>
            )}
          </div>

          {step != null && (
            <div className="hidden lg:flex items-center justify-between mb-6">
              <span className="text-xs text-white/55" data-testid="step-indicator-desktop">Step {step} of 3</span>
              {back && (
                <button
                  type="button"
                  onClick={back}
                  data-testid="welcome-back-desktop"
                  className="min-h-[44px] px-4 rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/75 cursor-pointer"
                >
                  ← Back
                </button>
              )}
            </div>
          )}

          <div>{children}</div>
        </div>
      </main>
    </div>
  );
}
