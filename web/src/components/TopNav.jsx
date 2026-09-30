import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import ModeBadge from './ModeBadge.jsx';
import WalletButton from './WalletButton.jsx';
import NotificationBell from './NotificationBell.jsx';
import HeaderBalance from './HeaderBalance.jsx';

// Quiet, full-width streaming top bar: brand + a central search on the left/middle,
// navigation and the money/notification/profile cluster pinned right. Search is
// purely client-side for now — it routes Discover to /?q=..., where the grid filters.
export default function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const q = new URLSearchParams(location.search).get('q') || '';
  const [term, setTerm] = useState(q);
  useEffect(() => { setTerm(q); }, [q]);

  const onSubmit = (e) => {
    e.preventDefault();
    const t = term.trim();
    navigate(t ? `/?q=${encodeURIComponent(t)}` : '/');
  };

  return (
    <nav className="sticky top-0 z-40 bg-bg/80 backdrop-blur border-b border-white/10">
      <div className="px-4 py-3 flex items-center gap-3 lg:gap-4">
        <Link to="/" className="font-heading font-bold text-lg shrink-0">LiveEdge</Link>
        <div className="hidden xl:block shrink-0"><ModeBadge /></div>

        <form onSubmit={onSubmit} role="search" className="hidden sm:flex items-center flex-1 max-w-xl">
          <div className="relative w-full">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search streams & markets"
              aria-label="Search"
              className="w-full bg-surface border border-white/10 rounded-full pl-4 pr-9 py-1.5 text-sm placeholder:text-white/35 focus:outline-none focus:border-white/25"
            />
            <button type="submit" aria-label="Submit search" className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-white/50 hover:text-white">⌕</button>
          </div>
        </form>

        <div className="hidden md:flex gap-4 text-sm ml-auto shrink-0">
          <Link to="/" className="text-white/70 hover:text-white">Browse</Link>
          <Link to="/portfolio" className="text-white/70 hover:text-white">Portfolio</Link>
          <Link to="/creator" className="text-white/70 hover:text-white">Create</Link>
          <Link to="/about" className="text-white/70 hover:text-white">About</Link>
        </div>
        <div className="flex items-center gap-2 ml-auto md:ml-0 shrink-0">
          <HeaderBalance />
          <NotificationBell />
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
