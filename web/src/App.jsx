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
import Welcome from './pages/Welcome.jsx';
import Legal from './pages/Legal.jsx';
import About from './pages/About.jsx';
import NotFound from './pages/NotFound.jsx';
import AuthModal from './components/AuthModal.jsx';
import SetupResumeBar from './components/SetupResumeBar.jsx';
import { AuthModalContext, useAuthModal } from './hooks/useAuthModal.jsx';
import { WelcomeModalContext, useWelcomeModal } from './hooks/useWelcomeModal.jsx';
import { useAuthProvider, AuthContext, useAuth } from './hooks/useAuth.js';
import { ToastContext } from './hooks/useToast.js';
import { BalanceContext, useBalanceProvider } from './hooks/useBalance.js';
import { emitDataRefresh } from './lib/data-bus.js';
import { shouldAutoEnterWelcome, canResumeWelcome, shouldShowCongrats, isWelcomeLatched } from './lib/welcome.js';
import { useState, useCallback, useEffect, useRef } from 'react';
import Toast from './components/Toast.jsx';

export default function App() {
  const auth = useAuthProvider();
  const [toast, setToast] = useState('');
  // A toast marks a completed action (trade/claim/fee/faucet/create/sign-in);
  // also nudge the bell + header balance to refetch via the data bus.
  const showToast = useCallback((message) => { setToast(message); emitDataRefresh(); }, []);
  // Sign-in is an OVERLAY on the current page (owner decision, Oct 2026) —
  // App owns the open state so any trigger (header, You-sheet, Portfolio…)
  // can pop it without navigating.
  const [authOpen, setAuthOpen] = useState(false);
  const openAuth = useCallback(() => setAuthOpen(true), []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);
  // Onboarding is a dismissible OVERLAY too (Oct 2026). Opening it also closes
  // the sign-in box: a successful sign-up hands off to setup, never both at once.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const openWelcome = useCallback(() => { setAuthOpen(false); setWelcomeOpen(true); }, []);
  const closeWelcome = useCallback(() => setWelcomeOpen(false), []);
  // Guest sign-in is REMOVED (Amendment 2) — no signIn wrapper/toast here
  // anymore; auth feedback belongs to the Privy flow + the /welcome cover.
  const balanceValue = useBalanceProvider(auth.user);
  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      <AuthContext.Provider value={auth}>
        <BalanceContext.Provider value={balanceValue}>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthModalContext.Provider value={{ open: authOpen, openAuth, closeAuth }}>
              <WelcomeModalContext.Provider value={{ open: welcomeOpen, openWelcome, closeWelcome }}>
                <Shell />
                <AuthModal />
                <WelcomeOverlayHost />
                <Toast message={toast} onDone={() => setToast('')} />
              </WelcomeModalContext.Provider>
            </AuthModalContext.Provider>
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
  const { openWelcome } = useWelcomeModal();
  // Landing gate (owner decision, Oct 2026): the LIVE FEED is the landing page.
  // Onboarding is a dismissible OVERLAY, not a takeover. A brand-new sign-up
  // (just_created) or the one owed congrats moment auto-opens the overlay ONCE
  // per mount; closing it never re-forces (autoOpenedRef), and the resume bar
  // reopens it. A returning unfinished account simply sees the resume bar.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    const congrats = shouldShowCongrats({
      just_created: user?.just_created,
      setup_completed: user?.setup_completed,
      latched: isWelcomeLatched(window.sessionStorage),
    });
    if (shouldAutoEnterWelcome(user) || congrats) {
      autoOpenedRef.current = true;
      openWelcome();
    }
  }, [user, openWelcome]);
  // The terms the onboarding paragraph promises must be READABLE by anyone,
  // anywhere — mid-setup accounts and guests included. /legal and /about are
  // therefore exempt from every gate and render standalone (the overlay host
  // hides itself on these routes so the page is never covered).
  if (pathname === '/legal' || pathname === '/about') {
    return (
      <Routes>
        <Route path="/legal" element={<Legal />} />
        <Route path="/about" element={<About />} />
      </Routes>
    );
  }
  const showRail = pathname === '/';
  return (
    <>
      <TopNav />
      {canResumeWelcome(user) && <SetupResumeBar />}
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
            <Route path="/signin" element={<SigninBridge />} />
            <Route path="/welcome" element={<WelcomeBridge />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
      <BottomTabs />
    </>
  );
}

// The old /signin PAGE is retired: signing in is the centered overlay now.
// Any bookmarked/stale /signin URL lands on the feed with the modal already
// open, so the dead end becomes the intended flow instead of a 404.
function SigninBridge() {
  const { openAuth } = useAuthModal();
  useEffect(() => { openAuth(); }, [openAuth]);
  return <Navigate to="/" replace />;
}

// A stale/bookmarked /welcome URL is no longer a page: it opens the onboarding
// OVERLAY and hands the URL back to the feed (mirrors SigninBridge).
function WelcomeBridge() {
  const { openWelcome } = useWelcomeModal();
  useEffect(() => { openWelcome(); }, [openWelcome]);
  return <Navigate to="/" replace />;
}

// The onboarding overlay floats above whatever route is showing, but yields to
// the gate-free /legal and /about pages so "Read the full Terms" is actually
// readable. It stays MOUNTED while hidden, so in-progress step answers survive
// the terms detour and reappear unchanged on the way back.
function WelcomeOverlayHost() {
  const { pathname } = useLocation();
  const { open } = useWelcomeModal();
  const onGateFree = pathname === '/legal' || pathname === '/about';
  return (
    <div style={{ display: open && !onGateFree ? 'block' : 'none' }}>
      {open && <Welcome />}
    </div>
  );
}
