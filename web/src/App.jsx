import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
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
import Welcome from './pages/Welcome.jsx';
import Legal from './pages/Legal.jsx';
import About from './pages/About.jsx';
import NotFound from './pages/NotFound.jsx';
import { useAuthProvider, AuthContext, useAuth } from './hooks/useAuth.js';
import { ToastContext } from './hooks/useToast.js';
import { BalanceContext, useBalanceProvider } from './hooks/useBalance.js';
import { emitDataRefresh } from './lib/data-bus.js';
import { needsSetup, shouldEnterWelcome, shouldShowCongrats, isWelcomeLatched } from './lib/welcome.js';
import { useState, useCallback } from 'react';
import Toast from './components/Toast.jsx';

export default function App() {
  const auth = useAuthProvider();
  const [toast, setToast] = useState('');
  // A toast marks a completed action (trade/claim/fee/faucet/create/sign-in);
  // also nudge the bell + header balance to refetch via the data bus.
  const showToast = useCallback((message) => { setToast(message); emitDataRefresh(); }, []);
  // Guest sign-in is REMOVED (Amendment 2) — no signIn wrapper/toast here
  // anymore; auth feedback belongs to the Privy flow + the /welcome cover.
  const balanceValue = useBalanceProvider(auth.user);
  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      <AuthContext.Provider value={auth}>
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
  const { user } = useAuth();
  // Account-takeover gate (docs/ONBOARDING_PLAN.md §2 abandonment path): an
  // authenticated account whose setup is NOT server-completed lands on the
  // full-screen /welcome cover — no TopNav/BottomTabs, no browsing past it.
  // Server fields only (needsSetup/shouldEnterWelcome); a just_created account
  // with setup already completed instead gets the ONE congrats screen (via the
  // same /welcome route) — never a repeat, guarded by the sessionStorage latch.
  const isWelcome = pathname === '/welcome' || pathname.startsWith('/welcome/');
  const congratsPending = shouldShowCongrats({
    just_created: user?.just_created,
    setup_completed: user?.setup_completed,
    latched: isWelcomeLatched(window.sessionStorage),
  });
  if (isWelcome) {
    // The cover owns the screen — no TopNav/BottomTabs chrome. /legal stays
    // reachable from Step 3 (the terms paragraph promises the full version).
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }
  if (needsSetup(user) && !congratsPending) return <Navigate to="/welcome" replace />;
  if (shouldEnterWelcome(user) && !congratsPending) return <Navigate to="/welcome" replace />;
  if (congratsPending) return <Navigate to="/welcome" replace />;
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
            <Route path="/legal" element={<Legal />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
      <BottomTabs />
    </>
  );
}
