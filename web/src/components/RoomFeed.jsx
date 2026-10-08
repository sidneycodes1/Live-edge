import VideoStage from './VideoStage.jsx';
import { detectEmbedFromUrl } from '../lib/embed.js';
import { IconExternal } from './Icons.jsx';
import HlsVideo from './HlsVideo.jsx';

// The Live Room's video area, provider-agnostic (docs §6). A room carries its
// feed as either a bound Kick channel (handled upstream in Room.jsx) or a
// `video_url`. We detect that URL's provider and:
//   • YouTube / .mp4           → mount the VERIFIED embed (standard, proven).
//   • Kick                     → official player.kick.com iframe (VERIFIED per
//     docs; RoomFeed keeps the honest gate for unproven hosts).
//   • empty / unknown           → the animated simulated stage (never a dead box).
// Everything degrades to VideoStage so the room always shows a live-looking surface.
export default function RoomFeed({ videoUrl, parent }) {
  const embed = detectEmbedFromUrl(videoUrl, parent);

  if (embed.kind === 'mp4' || embed.kind === 'none') {
    return <VideoStage videoUrl={embed.kind === 'mp4' ? videoUrl : null} />;
  }

  if (embed.kind === 'hls') {
    return <HlsVideo src={embed.src} className="md:aspect-auto md:h-full min-h-[300px]" />;
  }

  if (embed.kind === 'iframe' && embed.verified) {
    return (
      <div className="relative w-full aspect-video md:aspect-auto md:h-full min-h-[300px] bg-black rounded-card overflow-hidden border border-white/10" data-testid="room-video" data-provider={embed.provider}>
        <iframe
          title={`${embed.provider} stream`}
          src={embed.src}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  // Unverified provider iframe or external-only: keep the simulated feed + real link.
  return (
    <div className="space-y-2">
      <VideoStage videoUrl={null} />
      {embed.watchUrl && (
        <a
          href={embed.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition cursor-pointer"
          data-testid="room-video-external"
        >
          <IconExternal className="w-4 h-4" />
          This feed isn’t embeddable in the demo yet — watch it on the provider →
        </a>
      )}
    </div>
  );
}
