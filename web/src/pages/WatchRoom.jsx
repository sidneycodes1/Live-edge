import { useEffect, useMemo, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeLive } from '../lib/live.js';
import ChatFeed from '../components/ChatFeed.jsx';
import { useLiveConfig } from '../hooks/useLiveConfig.js';
import FeedEmbed from '../components/FeedEmbed.jsx';
import VideoStage from '../components/VideoStage.jsx';

// Generic watch surface for a live-grid channel (Kick / YouTube / curated /
// floor) opened from the grid.
//
// ROOM IDENTITY (Task A): the room is built DIRECTLY from the URL params + the
// router `state` handed over by LiveCard. A YouTube URL carries the VIDEO id, a
// curated 24/7 URL carries the UC CHANNEL id — enough to rebuild the embed with NO
// dependency on the rotating /api/live grid (the old bug: the grid re-lookup failed
// and the room fell back to showing a raw "UC…" as the title with no player). A grid
// lookup survives ONLY as a fallback for legacy channel-id URLs it can't interpret.
//
// CHAT: LiveEdge's own chat only. The provider-chat iframe path is retired (the
// banned "Sign in to chat" box lives inside a cross-origin frame we cannot restyle),
// so this column is always the LiveEdge ChatFeed + composer. Watch pages have no room
// row yet, so posting is gated to the honest no-room state (see the section 5a note in
// the component below). We never invent a roomId.

const UC_RE = /^UC[\w-]{20,}$/;

// Build a LiveChannel-shaped view straight from the route + nav state. Returns null
// when the params alone can't identify a stream (legacy /watch/youtube/<UC…> or an
// unknown source) → the caller then falls back to a grid lookup.
function channelFromParams(source, slug, titleParam, st) {
  const id = decodeURIComponent(slug || '');
  if (!id) return null;
  const title = st.title || (titleParam ? decodeURIComponent(titleParam) : '') || '';
  const name = st.channelName || '';
  const thumb = st.thumbnailUrl || '';

  if (source === 'youtube') {
    if (UC_RE.test(id)) return null; // legacy channel-level URL → grid fallback
    return {
      source: 'youtube',
      id: `youtube:${id}`,
      channelSlug: st.channelId || '',
      watchUrl: st.watchUrl || `https://www.youtube.com/watch?v=${id}`,
      title,
      channelName: name,
      thumbnailUrl: thumb,
      viewerCount: st.viewerCount == null ? null : st.viewerCount,
    };
  }

  if (source === 'curated-youtube') {
    if (UC_RE.test(id)) {
      // Channel-level 24/7 embed: always plays whatever the channel is live-streaming.
      return {
        source: 'curated-youtube',
        id: st.id || `yt-${id}`,
        channelSlug: id,
        liveEmbedUrl: st.liveEmbedUrl || `https://www.youtube.com/embed/live_stream?channel=${id}`,
        videoUrl: st.videoUrl || '',
        title: title || name,
        channelName: name,
        thumbnailUrl: thumb,
      };
    }
    // A concrete video id rode along → normal youtube embed via videoUrl.
    return {
      source: 'curated-youtube',
      id: st.id || `yt-${id}`,
      channelSlug: st.channelId || '',
      videoUrl: st.videoUrl || `https://www.youtube.com/watch?v=${id}`,
      watchUrl: st.watchUrl || '',
      liveEmbedUrl: st.liveEmbedUrl || '',
      title: title || name,
      channelName: name,
      thumbnailUrl: thumb,
    };
  }

  if (source === 'kick') {
    return {
      source: 'kick',
      id: `kick:${id}`,
      channelSlug: id,
      watchUrl: st.watchUrl || `https://kick.com/${id}`,
      title: title || id,
      channelName: name,
      thumbnailUrl: thumb,
    };
  }

  if (source === 'floor') {
    return {
      source: 'floor',
      id,
      channelSlug: '',
      watchUrl: st.watchUrl || id,
      title: title || id,
      channelName: name,
      thumbnailUrl: thumb,
    };
  }

  return null;
}

export default function WatchRoom() {
  const { source, slug, title: titleParam } = useParams();
  const location = useLocation();
  const st = location.state && typeof location.state === 'object' ? location.state : {};
  const { parent } = useLiveConfig();

  const direct = useMemo(
    () => channelFromParams(source, slug, titleParam, st),
    // st is a stable per-navigation object; recomputed only when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, slug, titleParam, location.state],
  );

  // Fallback grid lookup — ONLY for legacy/unknown params the URL can't resolve.
  const [found, setFound] = useState(null);
  const [loading, setLoading] = useState(!direct);
  useEffect(() => {
    if (direct) {
      setFound(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getLive(100)
      .then((raw) => {
        if (cancelled) return;
        const { items } = normalizeLive(raw);
        const id = decodeURIComponent(slug || '');
        const hit =
          items.find(
            (c) => c.source === source && (c.channelSlug === id || c.id === id || c.id === `${source}:${id}`),
          ) || null;
        setFound(hit);
      })
      .catch(() => {
        if (!cancelled) setFound(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [direct, source, slug]);

  // Prefer the direct build; then a grid hit (legacy); then a last-resort shell that
  // at least shows the outbound watch link — never a raw UC id as a fake title.
  const decodedSlug = decodeURIComponent(slug || '');
  const ch =
    direct ||
    found ||
    {
      source,
      channelSlug: decodedSlug,
      title: st.title || (titleParam ? decodeURIComponent(titleParam) : '') || '',
      channelName: st.channelName || '',
      thumbnailUrl: st.thumbnailUrl || '',
      liveEmbedUrl: st.liveEmbedUrl || (UC_RE.test(decodedSlug) && source === 'curated-youtube' ? `https://www.youtube.com/embed/live_stream?channel=${decodedSlug}` : ''),
      watchUrl: st.watchUrl || null,
      viewerCount: st.viewerCount == null ? null : st.viewerCount,
    };

  const displayTitle = ch.title || ch.channelName || 'Live stream';
  const hasViewers = ch.viewerCount != null && Number(ch.viewerCount) > 0;

  // Section 5a: /watch/:source/:slug has NO LiveEdge room row, so there is no
  // roomId to post into and no SSE stream to attach. Until the verifier ships a
  // GET /api/rooms/ensure?channel=<source:slug> (or an agreed room reuse), roomId
  // stays undefined and ChatComposer falls to its honest no-room state. When that
  // endpoint lands, resolve a real roomId here and pass roomId + useSSE().events.

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-20">
      <div className="flex items-center gap-2 text-xs text-white/50">
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-live/20 text-live px-2 py-0.5 rounded-full">
          real {source === 'curated-youtube' ? 'youtube 24/7' : source}
        </span>
        {loading && <span>loading…</span>}
        {hasViewers && <span className="num">{Math.round(Number(ch.viewerCount)).toLocaleString()} watching</span>}
      </div>
      <h1 className="font-heading font-bold text-xl mt-2">{displayTitle}</h1>
      {ch.channelName && ch.channelName !== displayTitle && (
        <p className="text-xs text-white/45 mt-1">{ch.channelName}</p>
      )}

      <div className="mt-4 grid md:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4 min-w-0">
          <FeedEmbed channel={ch} parent={parent} fallback={<VideoStage videoUrl={null} />} />
          <div className="bg-surface border border-white/10 rounded-card p-4">
            <p className="text-sm text-white/70">No prediction market is attached to this stream yet.</p>
            <p className="text-xs text-white/45 mt-1">Watch the real feed here, or open a simulated market on it.</p>
            <Link
              to="/creator"
              className="inline-block mt-3 px-4 py-2 rounded-card bg-white text-black text-sm font-semibold cursor-pointer hover:bg-white/90 transition"
            >
              Create a market →
            </Link>
          </div>
        </div>
        <div className="hidden md:block">
          <div className="h-[420px] md:h-[calc(100vh-8rem)] md:sticky md:top-4 rounded-card overflow-hidden border border-white/10">
            <ChatFeed messages={[]} sseEvents={[]} />
          </div>
        </div>
      </div>

      {/* Mobile chat (same honest panel, below the player) */}
      <div className="md:hidden mt-4 h-[360px] rounded-card overflow-hidden border border-white/10">
        <ChatFeed messages={[]} sseEvents={[]} />
      </div>
    </div>
  );
}
