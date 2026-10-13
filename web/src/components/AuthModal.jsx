import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { PLAY_MONEY_LINE } from '../lib/terms.js';
import Modal from './Modal.jsx';

// ---------------------------------------------------------------------------
// AuthModal — sign-in as an OVERLAY (owner decision, Oct 2026): clicking
// "Sign in" must NOT navigate to a page. The shared <Modal> shell draws the
// centered box over a dimmed/blurred backdrop; Login itself stays Privy-only
// (PRIVY_AUTH_SPEC Amendment 2/3: email OTP + Google, no guest mode); when
// Privy is not mounted the box says so honestly instead of a fake CTA.
// ---------------------------------------------------------------------------

export default function AuthModal() {
  const { open, closeAuth } = useAuthModal();
  const { loginWithPrivy, privyAvailable, user } = useAuth();

  return (
    <Modal open={open} onClose={closeAuth} testId="auth-modal" labelledBy="auth-modal-title">
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
          className="mt-5 w-full bg-brand text-brand-ink font-bold py-3 rounded-full min-h-[48px]"
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
    </Modal>
  );
}
