import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { useAuthModal } from '../hooks/useAuthModal.jsx';
import { composerMode, postChat, CHAT_MAX } from '../lib/chatComposer.js';

// LiveEdge's own chat composer (contract section 5, Agent A). Replaces the banned
// provider "Sign in to chat" box: a signed-in user posts to LiveEdge via api.chat();
// a guest gets a real sign-in affordance that opens the app's existing auth overlay;
// a room-less watch page is told the truth (section 5a) instead of being handed a
// dead button. Never a dead button; never a fabricated post.
export default function ChatComposer({ roomId, onPosted }) {
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const mode = composerMode({ user, roomId });

  // Guest: posting requires sign-in, so open the SAME overlay the header uses. This
  // is a live affordance (openAuth), not the banned non-functional provider box.
  if (mode === 'signin') {
    return (
      <div className="shrink-0 border-t border-white/10 p-3">
        <button
          type="button"
          data-testid="chat-signin"
          onClick={openAuth}
          className="w-full rounded-card bg-white text-black py-2 text-sm font-semibold cursor-pointer hover:bg-white/90 transition"
        >
          Sign in to post
        </button>
      </div>
    );
  }

  // Section 5a: a watch page has no room row, so there is nothing to post into. Be
  // honest -- do NOT invent a roomId and do NOT render a Send that can't send.
  if (mode === 'no-room') {
    return (
      <div data-testid="chat-no-room" className="shrink-0 border-t border-white/10 p-3 text-xs text-white/45">
        LiveEdge chat is not open for this stream yet -- it starts once a room is attached.
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await postChat({ api, roomId, body });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Optimistic append: show our own post immediately; ChatFeed dedups it when
      // the server echoes the same text back over SSE.
      onPosted?.({ ...res.message, name: res.message.name || user?.display_name || null });
      setBody('');
    } catch (err) {
      setError(err?.message || 'Could not send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-white/10 p-3 space-y-2">
      <textarea
        data-testid="chat-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={CHAT_MAX}
        placeholder="Chat with LiveEdge..."
        className="w-full resize-none rounded-card bg-white/5 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-white/40"
      />
      {error && (
        <p role="alert" data-testid="chat-error" className="text-[11px] text-no">{error}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-white/35 num">{body.length}/{CHAT_MAX}</span>
        <button
          type="submit"
          data-testid="chat-send"
          disabled={sending || !body.trim()}
          className="min-h-[36px] px-4 rounded-card bg-white text-black text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/90 transition"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  );
}