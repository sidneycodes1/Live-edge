import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useBalance } from '../hooks/useBalance.js';

// Live balance shown next to the wallet on every authenticated page (T2). Reads
// from the single BalanceContext, so it cannot drift from Portfolio's number.
export default function HeaderBalance() {
  const { user } = useAuth();
  const { balance } = useBalance() || {};
  if (!user) return null;
  return (
    <Link
      to="/portfolio"
      className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full num font-bold"
      data-testid="header-balance"
    >
      ${balance == null ? '—' : Number(balance).toFixed(2)}
    </Link>
  );
}
