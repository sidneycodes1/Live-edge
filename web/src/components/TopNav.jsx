import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import WalletButton from './WalletButton.jsx';
import NotificationBell from './NotificationBell.jsx';
import HeaderBalance from './HeaderBalance.jsx';

// Quiet, full-width streaming top bar: brand + a central search on the left/middle,
// navigation and the money/notification/profile cluster pinned right. Search is
// purely client-side — it routes Discover to /?q=..., where the grid filters.
//
// Mobile (<=sm): the inline search can't share one row with brand + balance + bell +
// wallet without crowding a 360px viewport, so search drops to its own full-width
// row underneath (still role=search, still labeled) and the primary cluster stays
// roomy. The desktop/tablet row keeps the inline search exactly as before.
function SearchField({ term, setTerm, onSubmit, className = '', id }) {
  return (
    <form onSubmit={onSubmit} role="search" className={`flex items-center ${className}`}>
      <div className="relative w-full">
        <input
          id={id}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search streams & markets"
          aria-label="Search"
          className="w-full bg-surface border border-white/10 rounded-full pl-4 pr-10 py-2 text-sm placeholder:text-white/35 focus:outline-none focus:border-white/25"
        />
        <button
          type="submit"
          aria-label="Submit search"
          data-icon
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full text-white/50 hover:text-white cursor-pointer"
        >⌕</button>
      </div>
    </form>
  );
}

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
      <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 lg:gap-4">
        <Link to="/" className="font-heading font-bold text-lg shrink-0">LiveEdge</Link>

        <SearchField term={term} setTerm={setTerm} onSubmit={onSubmit} id="desktop-search" className="hidden sm:flex flex-1 max-w-xl" />

        <div className="hidden md:flex gap-4 text-sm ml-auto shrink-0">
          <Link to="/portfolio" className="text-white/70 hover:text-white">Portfolio</Link>
          <Link to="/creator" className="text-white/70 hover:text-white">Create</Link>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto md:ml-0 shrink-0 min-w-0">
          <HeaderBalance />
          <NotificationBell />
          <WalletButton />
        </div>
      </div>

      {/* Full-width search row, phones only. Keeps search reachable without crowding
          the balance/bell/wallet cluster on a narrow viewport. */}
      <div className="sm:hidden px-3 pb-2.5">
        <SearchField term={term} setTerm={setTerm} onSubmit={onSubmit} id="mobile-search" className="" />
      </div>
    </nav>
  );
}
