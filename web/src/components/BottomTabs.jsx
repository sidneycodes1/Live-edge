import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { greetingName } from '../lib/welcome.js';
import InterestChips from './InterestChips.jsx';
import { IconFlame, IconSearch, IconPortfolio, IconUser } from './Icons.jsx';

// ---------------------------------------------------------------------------
// Mobile navigation (nav restructure): FOUR icon tabs — Live · Search ·
// Portfolio · You. Inline SVG icons (no emoji), every tab ≥44px tall.
// * Search deep-links to /?search=1 — TopNav focuses its search field there.
// * 'You' is not a route: it opens a bottom sheet with the account summary —
//   name, interests edit (the SAME Step-2 chips) and sign out. Signed out,
//   the sheet offers the Privy sign-in instead (Amendment 2: no guest mode).
// ---------------------------------------------------------------------------

export default function BottomTabs() {
  const loc = useLocation();
  const { user, signOut, saveProfile } = useAuth();
  const { openAuth } = useAuthModal();
  const [youOpen, setYouOpen] = useState(false);
  const [editInterests, setEditInterests] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sheetNote, setSheetNote] = useState('');
  const sheetRef = useRef(null);

  // Keep the sheet's chips in sync with the server truth when it opens.
  useEffect(() => {
    if (youOpen) {
      setEditInterests(Array.isArray(user?.interests) ? user.interests : []);
      setSheetNote('');
      sheetRef.current?.focus();
    }
  }, [youOpen, user]);

  // Escape closes the sheet (it is role=dialog).
  useEffect(() => {
    if (!youOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setYouOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [youOpen]);

  async function saveInterests() {
    if (!user || saving) return;
    setSaving(true);
    setSheetNote('');
    try {
      await saveProfile({ displayName: user.display_name, interests: editInterests });
      setSheetNote('Saved — your feed is tuned to this.');
    } catch (e) {
      setSheetNote(e?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const searchActive = loc.pathname === '/' && loc.search.includes('search=1');
  // !min-h-[56px]: the index.css tap rule (`a[href]{min-height:44px}`, higher
  // specificity) otherwise collapses the bar to 44px — the IMPORTANT prefix
  // keeps the intended 56px thumb-zone height while the inner targets stay >=44.
  const tabs = [
    { key: 'live', label: 'Live', to: '/', icon: IconFlame, active: loc.pathname === '/' && !searchActive },
    { key: 'search', label: 'Search', to: '/?search=1', icon: IconSearch, active: searchActive },
    { key: 'portfolio', label: 'Portfolio', to: '/portfolio', icon: IconPortfolio, active: loc.pathname.startsWith('/portfolio') },
  ];

  return (
    <>
      <div className="fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-white/10 flex md:hidden pb-safe">
        {tabs.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            aria-current={t.active ? 'page' : undefined}
            data-testid={`tab-${t.key}`}
            className={`flex-1 !min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${t.active ? 'text-white' : 'text-white/55'}`}
          >
            <t.icon className="w-5 h-5" />
            {t.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setYouOpen((v) => !v)}
          aria-expanded={youOpen}
          aria-label="You — account sheet"
          data-testid="tab-you"
          className={`flex-1 !min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold cursor-pointer ${youOpen ? 'text-white' : 'text-white/55'}`}
        >
          <IconUser className="w-5 h-5" />
          You
        </button>
      </div>

      {youOpen && (
        <div className="fixed inset-0 z-50 md:hidden" data-testid="you-sheet-backdrop" onClick={() => setYouOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Your account"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 inset-x-0 bg-surface border-t border-white/15 rounded-t-card p-5 pb-safe max-h-[80vh] overflow-y-auto focus:outline-none"
            data-testid="you-sheet"
          >
            <div className="w-9 h-1 rounded-full bg-white/20 mx-auto -mt-1 mb-4" aria-hidden="true" />
            <p className="font-heading font-bold text-lg">{user ? `Hey, ${greetingName(user)}` : 'Not signed in'}</p>
            {user ? (
              <>
                <p className="text-xs text-white/50 mt-1">
                  {user.display_name ? `@${user.display_name}` : 'No username yet'} · Play money for predictions. Not real money.
                </p>
                <p className="text-sm font-semibold mt-5 mb-2">Interests — what leads your feed</p>
                <InterestChips value={editInterests} onChange={setEditInterests} disabled={saving} />
                <button
                  type="button"
                  onClick={saveInterests}
                  disabled={saving}
                  data-testid="you-save-interests"
                  className="mt-4 w-full min-h-[44px] rounded-full bg-live text-white text-sm font-bold disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving…' : 'Save interests'}
                </button>
                {sheetNote && (
                  <p className="text-xs text-white/60 mt-2" data-testid="you-sheet-note">{sheetNote}</p>
                )}
                <button
                  type="button"
                  onClick={() => { signOut(); setYouOpen(false); }}
                  data-testid="you-sign-out"
                  className="mt-3 w-full min-h-[44px] rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/75 cursor-pointer"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-white/60 mt-2 leading-relaxed">
                  Pinning, betting and Portfolio need an account. Sign in with email code or Google —
                  it takes a few seconds.
                </p>
                {/* Sign-in is the centered overlay now (Oct 2026) — the sheet
                    hands off to it instead of navigating to /signin. */}
                <button
                  type="button"
                  onClick={() => { setYouOpen(false); openAuth(); }}
                  data-testid="you-sign-in"
                  className="mt-4 w-full min-h-[44px] rounded-full bg-live text-white text-sm font-bold cursor-pointer"
                >
                  Sign in
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setYouOpen(false)}
              className="mt-4 w-full min-h-[44px] text-sm text-white/50 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
