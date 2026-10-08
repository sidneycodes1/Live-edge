import { useEffect, useRef, useState } from 'react';
import { deriveChatItems } from '../lib/chat.js';
import { mergeOptimistic } from '../lib/chatComposer.js';
import ChatComposer from './ChatComposer.jsx';

// LiveEdge's own chat feed (contract section 5, Agent A). Container is SOLID BLACK
// with readable light text (section 0.3). The composer mounts beneath the list so a
// signed-in user can post; optimistic-append rows show at once and are deduped when
// the server echoes them back over SSE. min-h-64 keeps the feed usable in normal
// flow (Room watch-party/sim columns) while h-full lets it fill a fixed-height
// sidebar (Kick room / WatchRoom).
export default function ChatFeed({ messages, sseEvents, roomId }) {
  const ref = useRef(null);
  const [pending, setPending] = useState([]);
  const all = mergeOptimistic(deriveChatItems(messages, sseEvents), pending);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [all.length]);
  const onPosted = (msg) => setPending((prev) => [...prev, msg]);
  return (
    <div className="flex h-full min-h-64 flex-col bg-black">
      <div ref={ref} data-testid="chat-feed" className="flex-1 min-h-0 overflow-y-auto bg-black p-3 space-y-2">
        {all.map((m, i) => (
          <div key={i} data-kind={m.kind} className={`text-sm ${m.kind === 'trade' ? 'text-yes' : m.kind === 'system' ? 'text-live' : m.kind === 'ai' ? 'text-white/60' : 'text-white/80'}`}>
            {m.kind === 'ai' && <span data-testid="ai-badge" className="mr-1.5 px-1.5 py-0.5 rounded bg-white/15 text-[10px] font-bold uppercase tracking-wide text-white/70 align-middle">AI</span>}
            {m.kind === 'ai' && m.name && <span className="font-semibold text-white/50 mr-1">{m.name}</span>}
            {m.kind === 'chat' && m.name && <span className="font-semibold text-white/70 mr-1">{m.name}</span>}
            {m.kind === 'trade' ? '↗ ' : ''}{m.body}
          </div>
        ))}
        {all.length === 0 && <p className="text-white/40 text-sm">No messages yet</p>}
      </div>
      <ChatComposer roomId={roomId} onPosted={onPosted} />
    </div>
  );
}