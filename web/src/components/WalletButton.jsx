import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function WalletButton() {
  const { user, signIn, signOut, loading } = useAuth();
  const navigate = useNavigate();
  if (user) {
    const label = user.wallet ? `${user.wallet.slice(0, 4)}…${user.wallet.slice(-4)}` : 'Account';
    return (
      <div className="flex items-center gap-2">
        <Link to="/portfolio" className="text-xs bg-white/10 px-3 py-1 rounded-full hover:bg-white/20">
          {user.kind === 'email' ? user.email : `${label} · guest`}
        </Link>
        <button onClick={signOut} className="text-xs text-white/60 hover:text-white">Sign out</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Link to="/signin" className="bg-white text-black px-4 py-2 rounded-full text-sm font-bold">Sign in</Link>
      <button onClick={() => signIn().then(() => navigate('/portfolio'))} disabled={loading} className="text-xs text-white/60 hover:text-white">
        {loading ? 'Signing in…' : 'Continue as guest'}
      </button>
    </div>
  );
}
