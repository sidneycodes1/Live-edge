import { useAuth } from '../hooks/useAuth.js';
export default function WalletButton() {
  const { user, wallet, signIn, signOut, loading } = useAuth();
  if (user) return <div className="flex items-center gap-2"><span className="text-xs bg-white/10 px-3 py-1 rounded-full">{user.wallet.slice(0,4)}…{user.wallet.slice(-4)}</span><button onClick={signOut} className="text-xs text-white/60">Sign out</button></div>;
  return <button onClick={signIn} disabled={loading} className="bg-white text-black px-4 py-2 rounded-full text-sm font-bold disabled:opacity-50">{loading?'Signing...':'Sign in (Demo wallet)'}</button>;
}
