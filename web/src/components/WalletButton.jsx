import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';

export default function WalletButton() {
  const { user, signOut } = useAuth();
  const { openAuth } = useAuthModal();
  if (user) {
    const label = user.wallet ? `${user.wallet.slice(0, 4)}…${user.wallet.slice(-4)}` : 'Account';
    // Show the user's NAME, never the long email: display_name is the server's
    // chosen-handle field; an email account without one falls back to its local
    // part (up to the '@'). No guest states exist anymore (Amendment 2).
    const name = user.display_name || (user.email ? String(user.email).split('@')[0] : null);
    const display = name || label;
    return (
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <Link
          to="/portfolio"
          className="min-w-0 max-w-[92px] sm:max-w-[160px] truncate text-xs bg-white/10 px-3 py-1 rounded-full hover:bg-white/20"
          title={display}
        >
          {display}
        </Link>
        <button onClick={signOut} className="text-xs text-white/60 hover:text-white shrink-0">Sign out</button>
      </div>
    );
  }
  // Logged out: login-or-nothing (Amendment 2). Sign-in is the centered
  // overlay now (Oct 2026) — no page navigation; the modal itself carries the
  // honest "auth service unavailable" state when Privy is not mounted.
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <button onClick={openAuth} data-testid="sign-in-cta" className="bg-white text-black px-3 sm:px-4 py-2 rounded-full text-sm font-bold shrink-0 min-h-[44px]">Sign in</button>
    </div>
  );
}
