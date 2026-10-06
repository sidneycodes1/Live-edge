import { useState } from 'react';
import { useWelcomeModal } from '../hooks/useWelcomeModal.jsx';

// ---------------------------------------------------------------------------
// Setup resume bar (landing-gate rework, Oct 2026): an account whose onboarding
// was left unfinished is NEVER hijacked. It browses the live feed normally and
// sees this dismissible prompt instead — one tap reopens the onboarding OVERLAY
// (the same centered, blurred-backdrop box as sign-in), resuming at the right
// step.
// ---------------------------------------------------------------------------

export default function SetupResumeBar() {
  const [dismissed, setDismissed] = useState(false);
  const { openWelcome } = useWelcomeModal();
  if (dismissed) return null;
  return (
    <div
      className="max-w-6xl mx-auto px-4 pt-4"
      role="status"
      data-testid="resume-setup-bar"
    >
      <div className="flex items-center gap-3 rounded-card border border-live/40 bg-live/10 px-4 py-3">
        <p className="text-sm text-white/85 min-w-0">
          <span className="font-bold">Finish setting up your account</span>
          <span className="hidden sm:inline"> — a few seconds left: username, interests, terms.</span>
        </p>
        <button
          type="button"
          onClick={openWelcome}
          data-testid="resume-setup-cta"
          className="shrink-0 ml-auto min-h-[40px] inline-flex items-center rounded-full bg-live text-white text-sm font-bold px-4 hover:brightness-110 transition cursor-pointer"
        >
          Continue setup
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss setup reminder"
          data-testid="resume-setup-dismiss"
          className="shrink-0 w-10 h-10 -mr-1 grid place-items-center rounded-full text-white/55 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
