import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { PLAY_MONEY_LINE } from '../lib/terms.js';

// ---------------------------------------------------------------------------
// AuthModal — sign-in as an OVERLAY (owner decision, Oct 2026): clicking
// "Sign in" must NOT navigate to a page. A compact rectangle appears centered
// ON TOP of the current page; everything the box doesn't cover dims and
// blurs. Same centered layout on mobile and desktop; an X at the top closes
// it (plus Esc and backdrop click). Login itself stays Privy-only
// (PRIVY_AUTH_SPEC Amendment 2/3: email OTP + Google, no guest mode); when
// Privy is not mounted the box says so honestly instead of a fake CTA.
// ---------------------------------------------------------------------------

export default function AuthModal() {
  const { open, closeAuth } = useAuthModal();
  const { loginWithPrivy, privyAvailable, user } = useAuth();
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  // Esc closes while open (role=dialog contract).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeAuth(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeAuth]);

  // Focus the panel on open, hand focus back to the trigger on close.
  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const raf = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(raf);
      const prev = restoreRef.current;
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="auth-modal-backdrop"
      onClick={closeAuth}
    >
      {/* Dim + blur everything the box does not cover */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-card border border-white/15 bg-surface p-6 focus:outline-none"
        data-testid="auth-modal"
      >
        <button
          type="button"
          onClick={closeAuth}
          aria-label="Close"
          data-testid="auth-modal-close"
          className="absolute top-2 right-2 w-11 h-11 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          ✕
        </button>

        <h2 id="auth-modal-title" className="font-heading font-bold text-xl pr-10">Sign in to LiveEdge</h2>
        <p className="text-sm text-white/60 mt-2 leading-relaxed">
          Watch live streams and play the prediction feed with <strong>play money</strong> —
          not real money, no deposits, nothing to cash out. {PLAY_MONEY_LINE}
        </p>

        {user ? (
          <p className="text-sm text-white/70 mt-5" data-testid="auth-modal-signed-in">
            You&rsquo;re signed in.{' '}
            <Link to="/" onClick={closeAuth} className="underline">Back to the live feed</Link>
          </p>
        ) : privyAvailable ? (
          <button
            onClick={() => { loginWithPrivy(); }}
            data-testid="auth-modal-privy-cta"
            className="mt-5 w-full bg-white text-black font-bold py-3 rounded-full min-h-[48px]"
          >
            Sign in with email or Google
          </button>
        ) : (
          <p className="mt-5 text-sm text-white/60 border border-white/10 rounded-card p-4 bg-black/20" data-testid="auth-modal-unavailable">
            Sign-in is unavailable right now (the auth service isn&rsquo;t configured for this build).
            You can still browse everything that&rsquo;s live.
          </p>
        )}

        <p className="mt-4 text-xs text-white/40">
          New here? Signing in creates your account automatically — no password to remember.
        </p>
      </div>
    </div>
  );
}
