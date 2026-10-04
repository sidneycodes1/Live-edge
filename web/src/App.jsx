import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import TopNav from './components/TopNav.jsx';
import SideRail from './components/SideRail.jsx';
import BottomTabs from './components/BottomTabs.jsx';
import Discover from './pages/Discover.jsx';
import Room from './pages/Room.jsx';
import TwitchRoom from './pages/TwitchRoom.jsx';
import WatchRoom from './pages/WatchRoom.jsx';
import MatchView from './pages/MatchView.jsx';
import Creator from './pages/Creator.jsx';
import Portfolio from './pages/Portfolio.jsx';
import SignIn from './pages/SignIn.jsx';
import About from './pages/About.jsx';
import NotFound from './pages/NotFound.jsx';
import { useAuthProvider, AuthContext } from './hooks/useAuth.js';
import { ToastContext } from './hooks/useToast.js';
import { BalanceContext, useBalanceProvider } from './hooks/useBalance.js';
import { emitDataRefresh } from './lib/data-bus.js';
import { useState, useCallback, useMemo } from 'react';
import Toast from './components/Toast.jsx';

export default function App() {
  const auth = useAuthProvider();
  const [toast, setToast] = useState('');
  // A toast marks a completed action (trade/claim/fee/faucet/create/sign-in);
  // also nudge the bell + header balance to refetch via the data bus.
  const showToast = useCallback((message) => { setToast(message); emitDataRefresh(); }, []);
  // Wrap signIn so a successful guest sign-in surfaces feedback from ANY call site
  // (WalletButton, Room trade-gate, Portfolio) without duplicating the toast logic.
  const authValue = useMemo(
    () => ({
      ...auth,
      signIn: async (...args) => {
        const u = await auth.signIn(...args);
        if (u) showToast("Signed in as demo wallet — you've received $100 in play money");
        return u;
      },
    }),
    [auth, showToast],
  );
  const balanceValue = useBalanceProvider(auth.user);
  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      <AuthContext.Provider value={authValue}>
        <BalanceContext.Provider value={balanceValue}>
          <BrowserRouter>
            <Shell />
            <Toast message={toast} onDone={() => setToast('')} />
          </BrowserRouter>
        </BalanceContext.Provider>
      </AuthContext.Provider>
    </ToastContext.Provider>
  );
}

// The persistent channel rail belongs on the Browse surface only. Watch pages
// (room/twitch), the creator cockpit, portfolio and sign-in use the full width,
// mirroring how Twitch drops the sidebar on a VOD/theater view — and keeping
// those pages' first paint lean.
function Shell() {
  const { pathname } = useLocation();
  const showRail = pathname === '/';
  return (
    <>
      <TopNav />
      <div className="flex items-start">
        {showRail && <SideRail />}
        <div className="flex-1 min-w-0">
          <Routes>
            <Route path="/" element={<Discover />} />
            <Route path="/room/:id" element={<Room />} />
            <Route path="/twitch/:login" element={<TwitchRoom />} />
            <Route path="/watch/:source/:slug" element={<WatchRoom />} />
            <Route path="/watch/:source/:slug/:title" element={<WatchRoom />} />
            <Route path="/match/:fixtureId" element={<MatchView />} />
            <Route path="/creator/:roomId" element={<Creator />} />
            <Route path="/creator" element={<Creator />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
      <BottomTabs />
    </>
  );
}
