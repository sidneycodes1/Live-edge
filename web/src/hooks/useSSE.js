import { useEffect, useRef, useState } from 'react';

export function useSSE(roomId) {
  const [events, setEvents] = useState([]);
  const [viewers, setViewers] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!roomId) return;
    const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    const es = new EventSource(`${base}/api/stream/${roomId}`);
    esRef.current = es;
    const on = (type, handler) => es.addEventListener(type, handler);
    on('hello', (e) => { try { const d=JSON.parse(e.data); setViewers(d.viewers);} catch { /* ignore parse errors */ } });
    on('viewers', (e) => { try { const d=JSON.parse(e.data); setViewers(d.count);} catch { /* ignore parse errors */ } });
    on('odds', (e) => { try { const d=JSON.parse(e.data); setEvents(prev=>[...prev, {type:'odds', data:d}]); setLastUpdate(new Date());} catch { /* ignore parse errors */ } });
    on('trade', (e) => { try { const d=JSON.parse(e.data); setEvents(prev=>[...prev, {type:'trade', data:d}]); setLastUpdate(new Date());} catch { /* ignore parse errors */ } });
    on('chat', (e) => { try { const d=JSON.parse(e.data); setEvents(prev=>[...prev, {type:'chat', data:d}]); setLastUpdate(new Date());} catch { /* ignore parse errors */ } });
    on('market_created', (e) => { try { const d=JSON.parse(e.data); setEvents(prev=>[...prev, {type:'market_created', data:d}]);} catch { /* ignore parse errors */ } });
    on('market_status', (e) => { try { const d=JSON.parse(e.data); setEvents(prev=>[...prev, {type:'market_status', data:d}]);} catch { /* ignore parse errors */ } });
    es.onerror = () => {
      // auto reconnect handled by EventSource; show last update stale
    };
    return () => es.close();
  }, [roomId]);

  return { events, viewers, lastUpdate };
}
