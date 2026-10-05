import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

// ---------------------------------------------------------------------------
// Login landing — PRIVY ONLY (docs/PRIVY_AUTH_SPEC.md Amendment 2: guest mode
// removed; Amendment 3: login is Email OTP + Google through Privy's default
// modal). The old email+password form and "Continue as guest" are gone: the
// server still hosts those legacy routes during the migration, but the app
// must not surface them (TERMS_DRAFT §3: legacy password accounts can't sign
// in through the app anymore). If Privy isn't mounted (no VITE_PRIVY_APP_ID)
// we say so honestly instead of offering a fake sign-in.
// ---------------------------------------------------------------------------
export default function SignIn() {
  const { loginWithPrivy, privyAvailable, user } = useAuth();

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="font-heading font-bold text-2xl mb-1">Sign in to LiveEdge</h1>
      <p className="text-sm text-white/50 mb-6">
        Watch live streams and play the prediction feed with $100 in <strong>play money</strong> —
        not real money, no deposits, nothing to cash out.
      </p>

      {user ? (
        <p className="text-sm text-white/70" data-testid="signin-signed-in">
          You&rsquo;re signed in. <Link to="/" className="underline">Back to the live feed</Link>
        </p>
      ) : privyAvailable ? (
        <button
          onClick={loginWithPrivy}
          data-testid="privy-login-cta"
          className="w-full bg-white text-black font-bold py-3 rounded-full min-h-[44px]"
        >
          Sign in with email or Google
        </button>
      ) : (
        <p className="text-sm text-white/60 border border-white/10 rounded-card p-4 bg-surface" data-testid="signin-unavailable">
          Sign-in is unavailable right now (the auth service isn&rsquo;t configured for this build).
          You can still browse everything that&rsquo;s live.
        </p>
      )}

      <p className="mt-6 text-xs text-white/40">
        New here? Signing in creates your account automatically — no password to remember.
      </p>
    </div>
  );
}
