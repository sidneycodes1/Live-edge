import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinButton, liveCardHref, liveCardState } from './LiveCard.jsx';
import { tileGradient, channelInitial, hoverPreviewSrc } from '../lib/landing.js';

// ---------------------------------------------------------------------------
// LiveTile — the landing tile for a real live stream (contract §5/Agent C).
//
// The resting visual is the row's REAL provider thumbnail when it has one
// (YouTube/curated expose an i.ytimg.com image). Kick exposes NO per-stream
// thumbnail, so those rows fall back to a deterministic gradient derived from a
// hash of the channel slug (same channel → same gradient every visit) plus the
// channel's REAL initial. Either way a LIVE badge shows only when the row says
// isLive, and the REAL viewerCount shows only when present — when it is null we
// render nothing, never a fake 0. No invented art, ever.
//
// s5 hover-preview (owner ask: "want the live stream for all tiles"): hovering
// (or keyboard-focusing) the tile mounts the REAL muted autoplay embed over the
// gradient after a short dwell — but ONLY when landing.js's hoverPreviewSrc
// proves a verified embed exists for that provider (Kick/YouTube). Floor and
// any non-embeddable row never mount a frame (§1 honesty). The preview iframe
// is pointer-events-none, so the tile stays a single clean link and the pin
// button stays clickable. Reduced-motion users keep the static gradient.
//
// Shared by the landing category grids AND any rail that lists live channels.
// ---------------------------------------------------------------------------

const PREVIEW_DWELL_MS = 350;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function fmtViewers(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return String(v);
}

export default function LiveTile({ channel, pinned, onTogglePin }) {
  const [preview, setPreview] = useState(false);
  const timerRef = useRef(null);
  // One verified embed src per tile, computed only from real row fields.
  const previewSrc = channel ? hoverPreviewSrc(channel) : '';

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!channel) return null;
  const href = liveCardHref(channel);
  const initial = channelInitial(channel);
  // §1 honesty: show the count ONLY when the provider really gave one.
  const hasViewers = channel.viewerCount != null;

  const startPreview = () => {
    if (!previewSrc || preview || prefersReducedMotion()) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPreview(true), PREVIEW_DWELL_MS);
  };
  const stopPreview = () => {
    clearTimeout(timerRef.current);
    setPreview(false);
  };

  return (
    <div
      className="relative"
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      <PinButton pinned={pinned} onTogglePin={onTogglePin} channel={channel} className="absolute top-0 right-0 z-20" />
      <Link
        to={href || '/'}
        state={liveCardState(channel)}
        data-testid="live-tile"
        data-source={channel.source}
        onFocus={startPreview}
        onBlur={stopPreview}
        className="group block bg-surface rounded-card border border-white/10 overflow-hidden hover:border-white/25 transition cursor-pointer"
      >
        {/* Media: a REAL provider thumbnail when the row carries one (YouTube/curated
            expose i.ytimg.com art), else the honest deterministic gradient + the
            channel's REAL initial (Kick exposes no per-stream thumbnail). The
            gradient is decorative UI derived from the slug, never invented art. */}
        <div className="relative aspect-video overflow-hidden bg-surface" data-testid="live-tile-media">
          {channel.thumbnailUrl ? (
            <img
              src={channel.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              data-testid="live-tile-thumb"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{ backgroundImage: tileGradient(channel.channelSlug) }}
              data-testid="live-tile-gradient"
            >
              {initial && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 grid place-items-center font-heading font-bold text-6xl text-white/85 drop-shadow-lg select-none"
                >
                  {initial}
                </span>
              )}
            </div>
          )}
          {/* s5: the REAL stream, mounted over the media on hover/focus only.
              pointer-events-none keeps the tile a single link + pin target. */}
          {preview && previewSrc && (
            <iframe
              title={`Preview: ${channel.channelName || channel.channelSlug || channel.title || 'live stream'}`}
              src={previewSrc}
              className="absolute inset-0 w-full h-full pointer-events-none"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              data-testid="live-tile-preview"
            />
          )}
          {channel.isLive && (
            <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              LIVE
            </span>
          )}
          {hasViewers && (
            <span className="absolute bottom-2 right-2 z-10 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded num">
              {fmtViewers(channel.viewerCount)}
            </span>
          )}
          {/* P3: the server popped a genuinely-live football broadcast to the top of
              Sports — badge it honestly. Only ever set from the real row, never here. */}
          {channel.pinnedFootball && (
            <span className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 bg-live/90 text-on-warn text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
              data-testid="live-tile-football">
              Live football
            </span>
          )}
        </div>
        <div className="p-3">
          <h3 className="font-heading font-bold text-sm leading-snug line-clamp-2">{channel.title || 'Live stream'}</h3>
          <div className="flex items-center gap-2 mt-1.5 text-xs min-w-0">
            <span className="truncate text-white/70">{channel.channelName || channel.channelSlug || channel.owner}</span>
            {/* s4 source label: fallback rows are NEVER presented as Kick tiles. */}
            {channel.sourceLabel && (
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-white/60"
                data-testid="live-tile-source">
                via {channel.sourceLabel}
              </span>
            )}
            {channel.category && (
              <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-live/20 text-live">
                {channel.category}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
