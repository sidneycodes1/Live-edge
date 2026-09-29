import { BrowserRouter, Routes, Route } from 'react-router-dom';
import TopNav from './components/TopNav.jsx';
import BottomTabs from './components/BottomTabs.jsx';
import Discover from './pages/Discover.jsx';
import Room from './pages/Room.jsx';
import Creator from './pages/Creator.jsx';
import Portfolio from './pages/Portfolio.jsx';
import SignIn from './pages/SignIn.jsx';
import About from './pages/About.jsx';
import NotFound from './pages/NotFound.jsx';
import { useAuthProvider, AuthContext } from './hooks/useAuth.js';
import { ToastContext } from './hooks/useToast.js';
import { useState, useCallback, useMemo } from 'react';
import Toast from './components/Toast.jsx';

export default function App() {
  const auth = useAuthProvider();
  const [toast, setToast] = useState('');
  const showToast = useCallback((message) => setToast(message), []);
  // Wrap signIn so a successful sign-in surfaces feedback from ANY call site
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
  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      <AuthContext.Provider value={authValue}>
        <BrowserRouter>
          <TopNav />
          <Routes>
            <Route path="/" element={<Discover />} />
            <Route path="/room/:id" element={<Room />} />
            <Route path="/creator/:roomId" element={<Creator />} />
            <Route path="/creator" element={<Creator />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BottomTabs />
          <Toast message={toast} onDone={() => setToast('')} />
        </BrowserRouter>
      </AuthContext.Provider>
    </ToastContext.Provider>
  );
}
