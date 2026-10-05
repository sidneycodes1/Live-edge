import { chatEmbedSrc } from '../lib/twitch.js';

// Real Twitch chat embed. Shape per https://dev.twitch.tv/docs/embed/chat/ :
//   <iframe src="https://www.twitch.tv/embed/<channel>/chat?parent=<parent>">
// `parent` is the bare hosting domain (no protocol); the embed needs NO API creds.
// URL building is shared + unit-tested in ../lib/twitch.js.
export default function TwitchChat({ channel, parent, className = '' }) {
  const src = chatEmbedSrc(channel, parent);
  if (!src) return null;
  return (
    <iframe
      title={`Twitch chat: ${channel}`}
      src={src}
      data-testid="twitch-chat-embed"
      data-channel={channel}
      data-parent={parent}
      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; full-screen"
      className={`w-full h-full bg-black/20 ${className}`}
    />
  );
}
