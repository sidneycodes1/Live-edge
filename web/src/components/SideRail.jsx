import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeLive } from '../lib/live.js';
import { liveCardHref } from './LiveCard.jsx';
import { useAuth } from '../hooks/useAuth.js';

// Twitch-style persistent left rail. Lists LIVE CHANNELS — mixing the platform's
// own simulated rooms and any real Twitch channels from /api/twitch/live — each
// with an avatar and a live viewer count, exactly like the browse sidebar. It
// collapses to an icon strip (matching the "<" affordance in the reference shots)
// and is hidden entirely below `md`, where BottomTabs already covers navigation.
//
// Data is loaded once on mount (no background polling here): Discover owns the
// live-odds tick, and we deliberately avoid piling extra requests onto the app.
function fmtWatchers(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(v);
}

export default function SideRail() {
  const [rooms, setRooms] = useState([]);
  const [twitch, setTwitch] = useState([]);
  const [live, setLive] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    api.listRooms().then((r) => active && setRooms(Array.isArray(r) ? r : [])).catch(() => {});
    api.listTwitchLive(8).then((r) => active && setTwitch(r.items || [])).catch(() => {});
    // The real broadcast grid: when no platform ROOMS exist yet (engine between
    // rotations), the rail must still show what is actually live right now —
    // the same honest /api/live source the landing grid renders.
    api.getLive(10).then((r) => active && setLive(normalizeLive(r).items || [])).catch(() => {});
    return () => { active = false; };
  }, []);

  const roomEntries = rooms
    // Demo seeds (ViewerSeed/StreamerSeed rooms) must never pollute the rail —
    // real + engine rooms only. They stay reachable by direct URL for tests.
    .filter((r) => !r.isSeed)
    .map((r) => ({
      key: `r-${r.id}`, to: `/room/${r.id}`,
      name: r.title, sub: r.owner?.displayName || 'LiveEdge',
      viewers: r.viewers || 0, real: false,
    }));
  // Live-grid channels fill the rail below the rooms; a room already listed for
  // the same broadcast (engine room born from that stream) is not shown twice.
  const seenTitles = new Set(roomEntries.map((e) => String(e.name || '').toLowerCase().trim()));
  const liveEntries = live
    .map((c) => ({
      key: `l-${c.id}`,
      to: liveCardHref(c) || `/watch/${encodeURIComponent(c.source || 'live')}/${encodeURIComponent(c.channelSlug || c.id || '')}`,
      name: c.title || c.channelName || 'Live stream',
      sub: c.channelName || 'Live',
      viewers: c.viewerCount || 0, real: true,
    }))
    .filter((e) => !seenTitles.has(String(e.name).toLowerCase().trim()));

  const channels = [
    ...twitch.map((s) => ({
      key: `t-${s.id}`, to: `/twitch/${encodeURIComponent(s.userLogin)}`,
      name: s.userName || s.userLogin, sub: s.gameName || 'Live on Twitch',
      viewers: s.viewerCount || 0, real: true,
    })),
    ...roomEntries,
    ...liveEntries,
  ].slice(0, 14);

  return (
    <aside
      data-testid="side-rail"
      className={`hidden md:flex flex-col shrink-0 sticky top-[57px] self-start h-[calc(100vh-57px)] overflow-y-auto border-r border-white/10 bg-bg transition-all duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {!collapsed && <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">Live Channels</h2>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`${collapsed ? 'mx-auto' : 'ml-auto'} w-6 h-6 grid place-items-center rounded-full hover:bg-white/10 text-white/60`}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {user && !collapsed && (
        <nav className="px-2 pb-2 space-y-0.5 border-b border-white/5">
          <Link to="/portfolio" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 text-sm text-white/70">Your bets</Link>
          <Link to="/creator" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 text-sm text-white/70">Create a market</Link>
        </nav>
      )}

      <ul className="px-2 py-2 space-y-0.5">
        {channels.map((ch) => (
          <li key={ch.key}>
            <Link to={ch.to} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-white/5">
              <span className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-live/40 to-yes/30 border border-white/10 grid place-items-center text-xs font-bold text-white/80">
                {(ch.name || '?').slice(0, 1).toUpperCase()}
              </span>
              {!collapsed && (
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-sm text-white/85">{ch.name}</span>
                    {ch.real && <span className="shrink-0 text-[9px] font-bold uppercase text-live">live</span>}
                  </span>
                  <span className="block truncate text-xs text-white/45">
                    {ch.sub} · <span className="num">{fmtWatchers(ch.viewers)} watching</span>
                  </span>
                </span>
              )}
            </Link>
          </li>
        ))}
        {channels.length === 0 && !collapsed && <li className="px-3 py-2 text-xs text-white/40">No live channels right now.</li>}
      </ul>
    </aside>
  );
}
