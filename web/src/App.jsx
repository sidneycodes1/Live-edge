import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TopNav from './components/TopNav.jsx';
import BottomTabs from './components/BottomTabs.jsx';
import Discover from './pages/Discover.jsx';
import Room from './pages/Room.jsx';
import Creator from './pages/Creator.jsx';
import Portfolio from './pages/Portfolio.jsx';
import About from './pages/About.jsx';
import NotFound from './pages/NotFound.jsx';
import { useAuthProvider, AuthContext } from './hooks/useAuth.js';
import { useState } from 'react';
import Toast from './components/Toast.jsx';

export default function App() {
  const auth = useAuthProvider();
  const [toast, setToast] = useState('');
  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <TopNav />
        <Routes>
          <Route path="/" element={<Discover />} />
          <Route path="/room/:id" element={<Room />} />
          <Route path="/creator/:roomId" element={<Creator />} />
          <Route path="/creator" element={<Creator />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <BottomTabs />
        <Toast message={toast} onDone={()=>setToast('')} />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
