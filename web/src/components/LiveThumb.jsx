// Twitch-style 16:9 preview frame for a Discover tile. If the market has an image
// it breathes (Ken Burns) under a sweeping highlight; if not, an animated equalizer
// stands in so the tile still reads as a live picture rather than a dead box.
// A red LIVE badge (top-left) and a viewer count (bottom-right) mirror the browse
// grammar of the real Twitch cards.
const BARS = [0.9, 0.5, 1.2, 0.7, 1.05, 0.6, 1.3, 0.8, 0.55, 1.1, 0.75, 1.0];

function fmtViewers(n) {
  const v = Number(n) || 0;
  let s = v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(v);
  return `${s} ${v === 1 ? 'viewer' : 'viewers'}`;
}

export default function LiveThumb({ imageUrl, title, viewers = 0, live = true }) {
  return (
    <div className="relative aspect-video bg-black/40 overflow-hidden">
      {/* Base layer is ALWAYS the animated gradient+equalizer, so if the image is
          absent or fails to load (offline, blocked CDN) the tile still reads live
          instead of collapsing to a dead black box. */}
      <div className="absolute inset-0 flex items-end justify-center gap-1.5 px-4 pb-6 bg-gradient-to-br from-[#1a1a2e] via-surface to-[#0B0B10]" aria-hidden="true">
        {BARS.map((d, i) => (
          <span key={i} className="eq-bar w-1.5 rounded-full bg-gradient-to-t from-live/60 to-yes" style={{ height: '55%', animationDelay: `${d}s` }} />
        ))}
      </div>
      {imageUrl && (
        <img
          src={imageUrl}
          alt={title || ''}
          loading="lazy"
          className="kenburns absolute inset-0 w-full h-full object-cover opacity-90"
          onError={(e) => { e.currentTarget.remove(); }}
        />
      )}
      {/* sweeping highlight to sell motion */}
      <div className="sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      {live && (
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </span>
      )}
      <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded num">{fmtViewers(viewers)}</span>
    </div>
  );
}
