import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { IconBell } from './Icons.jsx';
import { onDataRefresh } from '../lib/data-bus.js';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.listNotifications();
      setItems(r.items || []);
      setUnread(r.unreadCount || 0);
    } catch { /* ignore transient fetch errors */ }
  }, [user]);

  useEffect(() => {
    if (!user) { setItems([]); setUnread(0); return; }
    load();
    const off = onDataRefresh(load);
    const timer = setInterval(load, 15000);
    return () => { off(); clearInterval(timer); };
  }, [user, load]);

  // close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;

  async function markAll(e) {
    e.stopPropagation();
    await api.markNotificationsRead({ all: true });
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at || new Date().toISOString() })));
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative p-2 rounded-full hover:bg-white/10 text-white/70"
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <IconBell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-no text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center" data-testid="notification-count">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-auto bg-surface border border-white/15 rounded-card shadow-xl z-50" data-testid="notification-panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 sticky top-0 bg-surface">
            <span className="text-xs font-bold text-white/70">Notifications</span>
            <button onClick={markAll} className="text-[11px] text-white/50 hover:text-white">Mark all read</button>
          </div>
          {items.length === 0 && <p className="text-xs text-white/40 p-4 text-center">No notifications yet</p>}
          {items.map((n) => (
            <div key={n.id} className={`px-3 py-2 border-b border-white/5 ${n.read_at ? 'opacity-50' : ''}`}>
              <p className="text-sm text-white/85">{n.body}</p>
              <p className="text-[10px] text-white/40 mt-0.5">{timeAgo(n.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
