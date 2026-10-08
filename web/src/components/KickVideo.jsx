import { playerEmbedSrc, channelWatchUrl } from '../lib/kick.js';

// Real Kick video embed via the OFFICIAL iframe (docs.kick.com):
//   https://player.kick.com/<channel>?autoplay=true&muted=true
// No parent domain handshake and no API creds are needed for the player.
// Kick exposes no JS player-events API (unlike Twitch's Player.OFFLINE), so
// when a stream ends the player itself shows Kick's offline screen inside the
// frame — we add an honest caption + a link to the channel, never a fake
// "offline detected" state.
//
// The intended src is stamped on the wrapper as a data-* attr so the embed is
// verifiable even when the remote frame can't load (offline CI sandbox).
export default function KickVideo({ channel }) {
  const src = playerEmbedSrc(channel);
  if (!src) return null;
  return (
    <div
      className="relative w-full aspect-video bg-black rounded-card overflow-hidden border border-white/10"
      data-testid="kick-video-embed"
      data-channel={channel}
      data-player-src={src}
    >
      <iframe
        title={`Kick stream: ${channel}`}
        src={src}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

// Kick chat card: there is NO official chat-only embed, so the sidebar links
// out to the channel page where real chat lives (§4 honesty — never a fake
// chat box). The LiveEdge market chat renders alongside it in the room.
export function KickChatLinkOut({ channel }) {
  const url = channelWatchUrl(channel);
  if (!url) return null;
  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-3 bg-black/20 px-5 text-center"
      data-testid="kick-chat-linkout"
      data-channel={channel}
    >
      <p className="text-sm text-white/60 max-w-xs">
        Real Kick chat lives on the channel page — Kick offers no official chat-only embed, so we link
        out instead of pretending.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block px-4 py-2 rounded-card bg-white text-black text-sm font-semibold cursor-pointer hover:bg-white/90 transition"
      >
        Open kick.com/{channel} ↗
      </a>
    </div>
  );
}
