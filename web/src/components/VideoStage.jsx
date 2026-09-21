export default function VideoStage({ videoUrl }) {
  if (videoUrl && videoUrl.endsWith('.mp4')) {
    return <video src={videoUrl} autoPlay muted loop controls className="w-full h-full object-cover rounded-card" />;
  }
  return (
    <div className="w-full h-[300px] md:h-full bg-gradient-to-br from-[#1a1a2e] to-[#0B0B10] rounded-card flex items-center justify-center border border-white/10">
      <div className="text-center">
        <div className="text-4xl mb-2">▶</div>
        <p className="text-white/60 text-sm">Stream placeholder</p>
        <p className="text-white/30 text-xs mt-1">Demo video would play here</p>
      </div>
    </div>
  );
}
