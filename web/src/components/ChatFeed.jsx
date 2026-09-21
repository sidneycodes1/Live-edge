import { useEffect, useRef } from 'react';

export default function ChatFeed({ messages, sseEvents }) {
  const ref = useRef(null);
  const all = [
    ...messages,
    ...sseEvents.filter(e=>e.type==='chat' || e.type==='trade').map(e=> ({ kind:e.type, body:e.data.body || `${e.data.name} backed ${e.data.side} for $${e.data.amount}`, isSSE:true }))
  ];
  useEffect(()=>{ if(ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [all.length]);
  return (
    <div ref={ref} className="h-64 overflow-y-auto bg-black/20 rounded-card p-3 space-y-2">
      {all.map((m,i)=> (
        <div key={i} className={`text-sm ${m.kind==='trade'?'text-yes': m.kind==='system'?'text-live':'text-white/80'}`}>
          {m.kind==='trade' ? '↗ ' : ''}{m.body}
        </div>
      ))}
      {all.length===0 && <p className="text-white/40 text-sm">No messages yet</p>}
    </div>
  );
}
