import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';

export default function SignIn() {
  const { register, login, signIn, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('create'); // 'create' | 'login'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'create') {
        await register(email, password);
        showToast('Account created — you\'ve received $100 in play money');
      } else {
        await login(email, password);
        showToast('Welcome back');
      }
      navigate('/portfolio');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    }
  }

  async function continueAsGuest() {
    setError('');
    try {
      await signIn();
      // App wraps signIn() to fire the guest/welcome toast from any call site.
      navigate('/portfolio');
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="font-heading font-bold text-2xl mb-1">Get started</h1>
      <p className="text-sm text-white/50 mb-6">Create an account or continue as a guest. Guest wallets hold play money only.</p>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setMode('create')} className={`flex-1 py-2 rounded-full text-sm font-bold ${mode === 'create' ? 'bg-white text-black' : 'bg-white/10'}`}>Create account</button>
        <button onClick={() => setMode('login')} className={`flex-1 py-2 rounded-full text-sm font-bold ${mode === 'login' ? 'bg-white text-black' : 'bg-white/10'}`}>Log in</button>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'create' ? 'Password (min 8 characters)' : 'Password'}
          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-no" data-testid="signin-error">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-white text-black font-bold py-3 rounded-full disabled:opacity-50">
          {loading ? 'Working…' : mode === 'create' ? 'Create account' : 'Log in'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button onClick={continueAsGuest} disabled={loading} className="text-sm text-white/60 underline disabled:opacity-50">Continue as guest</button>
      </div>
    </div>
  );
}
