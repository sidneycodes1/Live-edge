import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function WalletButton() {
  const { user, signIn, signOut, loading } = useAuth();
  const navigate = useNavigate();
  if (user) {
    const label = user.wallet ? `${user.wallet.slice(0, 4)}…${user.wallet.slice(-4)}` : 'Account';
    const display = user.kind === 'email' ? user.email : `${label} · guest`;
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
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <Link to="/signin" className="bg-white text-black px-3 sm:px-4 py-2 rounded-full text-sm font-bold shrink-0">Sign in</Link>
      {/* Phones reach guest mode from the Sign-in page (same handler); the inline
          affordance lives on >=sm widths so the top row never crowds. */}
      <button onClick={() => signIn().then(() => navigate('/portfolio'))} disabled={loading} className="hidden sm:inline text-xs text-white/60 hover:text-white">
        {loading ? 'Signing in…' : 'Continue as guest'}
      </button>
    </div>
  );
}
