// F-014: this is a deliberate animated "simulated live feed" preview, not a dead
// placeholder. A real clip (an .mp4 video_url) always takes priority and plays
// inline; everything else renders the branded mock so the room never looks broken.
const BARS = [0.9, 0.5, 1.2, 0.7, 1.05, 0.6, 1.3, 0.8, 0.55, 1.1, 0.75, 1.0];

export default function VideoStage({ videoUrl }) {
  if (videoUrl && videoUrl.endsWith('.mp4')) {
    return <video src={videoUrl} autoPlay muted loop controls className="w-full h-full object-cover rounded-card" />;
  }
  return (
    <div className="relative w-full h-[300px] md:h-full overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-[#1a1a2e] via-surface to-[#0B0B10]">
      {/* sweeping highlight to read as motion */}
      <div className="sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      {/* live badge */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-full">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[11px] font-semibold tracking-wide text-white/90">LIVE</span>
      </div>
      <div className="absolute top-3 right-3 text-[11px] text-white/40">Simulated feed</div>
      {/* centered glyph + equalizer */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <span className="text-2xl translate-x-[2px]">▶</span>
        </div>
        <div className="flex items-end gap-1.5 h-10" aria-hidden="true">
          {BARS.map((d, i) => (
            <span
              key={i}
              className="eq-bar w-1.5 rounded-full bg-gradient-to-t from-live/60 to-yes"
              style={{ height: '100%', animationDelay: `${d}s` }}
            />
          ))}
        </div>
        <p className="text-white/70 text-sm font-medium">Live stream preview</p>
        <p className="text-white/40 text-xs max-w-xs text-center px-4">
          This room is running in demo mode — drop a stream URL (or an .mp4) on the room to replace this animated preview with the real broadcast.
        </p>
      </div>
    </div>
  );
}
