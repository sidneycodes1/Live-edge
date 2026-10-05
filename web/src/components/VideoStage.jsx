// The watch-room video surface. A real clip (an .mp4 video_url) plays inline. When
// there is no playable feed we show a NEUTRAL, honest panel — no animated equalizer,
// no fake "LIVE"/"Simulated feed"/"demo mode" claim (§4: never dress a non-broadcast
// up as a live picture). The room's market, chat and odds still work around it.
export default function VideoStage({ videoUrl }) {
  if (videoUrl && videoUrl.endsWith('.mp4')) {
    return <video src={videoUrl} autoPlay muted loop controls className="w-full h-full object-cover rounded-card" />;
  }
  return (
    <div className="relative w-full h-[300px] md:h-full overflow-hidden rounded-card border border-white/10 bg-black/30 grid place-items-center px-6 text-center">
      <div>
        <p className="text-white/70 text-sm font-medium">No live broadcast attached yet</p>
        <p className="text-white/40 text-xs mt-1 max-w-xs">
          This room has the market, chat and odds. A real stream can be attached to it.
        </p>
      </div>
    </div>
  );
}
