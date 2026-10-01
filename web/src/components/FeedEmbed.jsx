import { buildVideoEmbed } from '../lib/embed.js';
import { IconExternal } from './Icons.jsx';
import TwitchVideo from './TwitchVideo.jsx';

// Provider-agnostic video surface for the live grid's watch rooms. It resolves a
// LiveChannel through the embed map (§6) and then:
//   • Twitch / YouTube  → mount the VERIFIED embed (Twitch delegates to the existing
//     tested TwitchVideo so its data-* attrs / testids are preserved).
//   • Kick / Livepeer   → these are NOT VERIFIED in a real browser yet, so we DO NOT
//     rely on them in the demo path. We show the caller's fallback (the honest
//     simulated feed) plus a real "watch on the provider" outbound link. Gating —
//     not pretending — keeps the never-empty grid from looking broken (§4).
//   • external / none    → fallback + outbound link (if any).
//
// `fallback` is required: without it an unverified/absent embed would leave a hole.

function YouTubeFrame({ src, videoId }) {
  return (
    <div
      className="relative w-full aspect-video bg-black rounded-card overflow-hidden border border-white/10"
      data-testid="youtube-video-embed"
      data-video-id={videoId}
    >
      <iframe
        title="YouTube live stream"
        src={src}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}

function ExternalPanel({ title, embed, fallback }) {
  return (
    <div className="space-y-3">
      {fallback}
      <div className="bg-surface border border-white/10 rounded-card p-4">
        <p className="text-sm text-white/70">
          {embed.provider === 'kick'
            ? 'Kick playback isn’t verified in our demo yet.'
            : embed.provider === 'floor'
              ? 'Livepeer HLS playback isn’t verified in our demo yet.'
              : 'This feed can’t be embedded here.'}{' '}
          Watch it on the provider instead — the market below still works.
        </p>
        {embed.watchUrl && (
          <a
            href={embed.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-card bg-white text-black text-sm font-semibold cursor-pointer hover:bg-white/90 transition"
          >
            <IconExternal className="w-4 h-4" />
            {title}
          </a>
        )}
      </div>
    </div>
  );
}

const PROVIDER_NAME = { kick: 'Kick', youtube: 'YouTube', twitch: 'Twitch', floor: 'stream' };

export default function FeedEmbed({ channel, parent, fallback = null }) {
  const embed = buildVideoEmbed(channel, parent);

  if (embed.kind === 'iframe' && embed.verified) {
    if (embed.provider === 'twitch') {
      return <TwitchVideo channel={channel.channelSlug} parent={parent} />;
    }
    if (embed.provider === 'youtube') {
      // videoId is the last path segment of the embed URL.
      const videoId = (embed.src.match(/embed\/([^/?]+)/) || [])[1] || '';
      return <YouTubeFrame src={embed.src} videoId={videoId} />;
    }
  }

  // Unverified iframe (kick), hls (floor), external, or none → gate honestly.
  const name = PROVIDER_NAME[embed.provider] || 'stream';
  return <ExternalPanel title={`Watch on ${name}`} embed={embed} fallback={fallback} />;
}
