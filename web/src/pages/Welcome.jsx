import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useWelcomeModal } from '../hooks/useWelcomeModal.jsx';
import InterestChips, { ALL_INTERESTS } from '../components/InterestChips.jsx';
import { IconPlay } from '../components/Icons.jsx';
import {
  TERMS_SUMMARY_PARAGRAPH,
  TERMS_CHECKBOX_LABEL,
  TERMS_VERSION,
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
  greetingName,
} from '../lib/welcome.js';

// ---------------------------------------------------------------------------
// /welcome — the account setup flow, rendered as an OVERLAY (owner decision,
// Oct 2026): the same centered card on a dimmed, blurred live feed as the
// sign-in box, on mobile AND desktop. It is mounted only while the welcome
// modal is open (App owns that state), so the Discover feed stays browsable
// behind it and the X (or Esc / backdrop) simply closes it back to the feed —
// the account stays "unfinished" and the resume bar brings it back.
// Three steps, always labelled "Step x of 3":
//   1. USERNAME   required, inline validation mirroring the server zod rule.
//   2. INTERESTS  three chips, skippable (skip selects all three so resume
//                 never re-visits an empty shelf), Back works.
//   3. TERMS      the exact TERMS_DRAFT Part-3 paragraph + 18+/agree checkbox;
//                 [Create my account] stays disabled until it is checked, then
//                 POSTs /api/me/setup (Agent A2's contract, plan §4).
// Success AND a just_created resume land on a calm congrats screen (play-money
// wording stays; the old $100 count-up ceremony was removed by the owner).
// ---------------------------------------------------------------------------

const STEPS = [
  { n: 1, title: 'Choose a username' },
  { n: 2, title: 'Pick your interests' },
  { n: 3, title: 'Accept the terms' },
];

// The congrats moment. No number ceremony (Oct 2026): the funded amount is
// whatever the server actually granted, and Portfolio is the single honest
// surface for it. Marked once so it never repeats in the tab.
function Congrats() {
  const navigate = useNavigate();
  const { closeWelcome } = useWelcomeModal();
  const { user } = useAuth();
  useEffect(() => {
    markWelcomeShown(window.sessionStorage); // never shows twice in this tab
  }, []);

  function finish() {
    closeWelcome();
    navigate('/', { state: { focusFirstCard: true } });
  }

  return (
    <div className="text-center py-2" data-testid="welcome-congrats">
      <p className="text-xs uppercase tracking-widest text-live font-bold">Welcome to LiveEdge</p>
      <h2 className="font-heading font-bold text-3xl mt-5" data-testid="congrats-title">
        You&rsquo;re in, {greetingName(user)}
      </h2>
      <p className="text-base font-semibold mt-4 leading-snug">Your feed is ready — pick a stream and make your first prediction.</p>
      <p className="inline-block mt-3 text-[11px] font-semibold uppercase tracking-wide bg-white/10 text-white/70 px-3 py-1 rounded-full">
        {PLAY_MONEY_LINE}
      </p>
      <button
        type="button"
        data-testid="first-prediction-cta"
        onClick={finish}
        className="mt-7 w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-full bg-live text-white font-bold hover:brightness-110 transition cursor-pointer"
      >
        <IconPlay className="w-4 h-4" />
        Make your first prediction
      </button>
    </div>
  );
}

export default function Welcome() {
  const { user, loading, completeSetup, loginWithPrivy, privyAvailable } = useAuth();
  const { closeWelcome } = useWelcomeModal();
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
  const panelRef = useRef(null);
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
  // second mount of this flow) goes straight to the one congrats screen.
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
  // account arriving via the resume bar was re-onboarded inside the overlay.
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

  // Setup is server-complete and no congrats is owed: close the overlay instead
  // of showing an account a cover it already finished.
  useEffect(() => {
    if (phase === 'home') closeWelcome();
  }, [phase, closeWelcome]);

  // role=dialog contract: Esc closes, focus lands on the panel on open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeWelcome(); };
    window.addEventListener('keydown', onKey);
    const raf = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      window.removeEventListener('keydown', onKey);
      window.cancelAnimationFrame(raf);
    };
  }, [closeWelcome]);

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
      // One-shot channel: the "Tuned for {name}" note Discover shows once.
      setTunedNote(window.sessionStorage, displayName.trim());
      setPhase('congrats');
    } catch (e) {
      // Honest failure: say it failed, keep everything they typed, let them retry.
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
  // A complete account is on its way to closing; render nothing meanwhile.
  if (phase === 'home') return null;

  let body = null;
  let cta = null;
  let showChrome = true; // step indicator + Back rail

  if (phase === 'congrats') {
    showChrome = false;
    body = <Congrats />;
  } else if (!user) {
    // Login-or-nothing (Amendment 2): there is no guest setup. An unauthenticated
    // visitor who opens the flow gets the honest Privy prompt — and the public
    // feed stays browsable behind it (logged-out browsing is allowed; setup is not).
    showChrome = false;
    if (loading) {
      body = <p className="text-white/50 text-sm text-center py-10">Loading…</p>;
    } else {
      body = (
        <div className="text-center py-2" data-testid="welcome-signed-out">
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
            /* No Privy mounted => no sign-in path exists (Amendment 2). Say so
               honestly; the old /signin page is retired. */
            <p className="mt-6 text-sm text-white/60 border border-white/10 rounded-card p-4 bg-black/20" data-testid="welcome-signin-unavailable">
              Sign-in is unavailable right now (the auth service isn&rsquo;t configured for this build).
            </p>
          )}
          <button
            type="button"
            onClick={closeWelcome}
            className="inline-block mt-4 text-sm text-white/50 underline hover:text-white/80 cursor-pointer"
          >
            Browse without an account
          </button>
        </div>
      );
    }
  } else {
    // ---- the three steps --------------------------------------------------
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
          <h2 className="font-heading font-bold text-xl">One paragraph before you&rsquo;re in</h2>
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
  }

  const back = showChrome && step > 1 ? () => setStep((s) => s - 1) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="welcome-overlay"
      onClick={closeWelcome}
    >
      {/* Dim + blur the live feed behind the card (same treatment as sign-in) */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Set up your account"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-card border border-white/15 bg-surface p-6 pb-safe focus:outline-none"
        data-testid="welcome-modal"
      >
        <button
          type="button"
          onClick={closeWelcome}
          aria-label="Close"
          data-testid="welcome-close"
          className="absolute top-2 right-2 w-11 h-11 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          ✕
        </button>

        {/* Card header: brand + (step chrome) */}
        <div className="flex items-center gap-3 pr-10">
          <p className="font-heading font-bold text-lg">LiveEdge</p>
          {showChrome && (
            <span className="text-xs text-white/55 ml-auto shrink-0" data-testid="step-indicator">Step {step} of 3</span>
          )}
        </div>

        {showChrome && (
          <div className="flex items-center gap-3 mt-4">
            {STEPS.map((s) => (
              <span
                key={s.n}
                aria-hidden="true"
                className={`h-1 flex-1 rounded-full ${s.n < step ? 'bg-live' : s.n === step ? 'bg-live/70' : 'bg-white/15'}`}
                data-testid={`rail-step-${s.n}`}
              />
            ))}
          </div>
        )}

        <div className="mt-5">{body}</div>

        {cta && <div className="mt-6">{cta}</div>}

        {back && (
          <button
            type="button"
            onClick={back}
            data-testid="welcome-back"
            className="mt-3 w-full min-h-[44px] rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/75 cursor-pointer"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
