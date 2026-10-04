import { useEffect, useRef } from 'react';
import { deriveChatItems } from '../lib/chat.js';

export default function ChatFeed({ messages, sseEvents }) {
  const ref = useRef(null);
  const all = deriveChatItems(messages, sseEvents);
  useEffect(()=>{ if(ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [all.length]);
  return (
    <div ref={ref} className="h-64 overflow-y-auto bg-black/20 rounded-card p-3 space-y-2">
      {all.map((m,i)=> (
        <div key={i} data-kind={m.kind} className={`text-sm ${m.kind==='trade'?'text-yes': m.kind==='system'?'text-live': m.kind==='ai'?'text-white/60':'text-white/80'}`}>
          {m.kind==='ai' && <span data-testid="ai-badge" className="mr-1.5 px-1.5 py-0.5 rounded bg-white/15 text-[10px] font-bold uppercase tracking-wide text-white/70 align-middle">AI</span>}
          {m.kind==='ai' && m.name && <span className="font-semibold text-white/50 mr-1">{m.name}</span>}
          {m.kind==='trade' ? '↗ ' : ''}{m.body}
        </div>
      ))}
      {all.length===0 && <p className="text-white/40 text-sm">No messages yet</p>}
    </div>
  );
}
