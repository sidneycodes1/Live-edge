import { Link } from 'react-router-dom';
import ModeBadge from './ModeBadge.jsx';
import WalletButton from './WalletButton.jsx';

export default function TopNav() {
  return (
    <nav className="sticky top-0 z-40 bg-bg/80 backdrop-blur border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="font-heading font-bold text-lg">LiveEdge</Link>
        <ModeBadge />
        <div className="hidden md:flex gap-4 ml-6 text-sm">
          <Link to="/" className="text-white/70 hover:text-white">Discover</Link>
          <Link to="/portfolio" className="text-white/70 hover:text-white">Portfolio</Link>
          <Link to="/about" className="text-white/70 hover:text-white">About</Link>
        </div>
        <div className="ml-auto"><WalletButton /></div>
      </div>
    </nav>
  );
}
