import { useEffect, useRef, useState } from 'react';
import { playerEmbedSrc, buildPlayerOptions } from '../lib/twitch.js';

// Real Twitch video embed using the INTERACTIVE player API, because that is the
// documented way to detect a channel going offline mid-session:
//   https://dev.twitch.tv/docs/embed/video-and-clips/  →
//   Twitch.Player fires the OFFLINE ("Loaded channel goes offline") and ONLINE
//   events via js/embed/v1.js. The plain non-interactive iframe can't do that.
// `parent` is the bare serving domain (no protocol); embeds need NO API creds.
//
// We also stamp the intended channel/parent onto the wrapper as data-* attrs so
// the embed is verifiable even when the external player script can't be fetched
// (e.g. an offline CI sandbox running the browser E2E).
const PLAYER_SCRIPT = 'https://player.twitch.tv/js/embed/v1.js';

let scriptPromise = null;
function loadTwitchPlayerScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if (window.Twitch && window.Twitch.Player) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PLAYER_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('twitch-player-script-failed'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function TwitchVideo({ channel, parent }) {
  const holderRef = useRef('twitch-player-' + Math.random().toString(36).slice(2));
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!channel || !parent) return undefined;
    let cancelled = false;
    let player = null;
    setOffline(false);
    setLoading(true);
    loadTwitchPlayerScript()
      .then(() => {
        if (cancelled || typeof window === 'undefined') return;
        const el = document.getElementById(holderRef.current);
        const Player = window.Twitch && window.Twitch.Player;
        if (!el || !Player) {
          if (!cancelled) { setOffline(true); setLoading(false); }
          return;
        }
        player = new Player(holderRef.current, buildPlayerOptions(channel, parent));
        player.addEventListener(Player.READY, () => { if (!cancelled) setLoading(false); });
        player.addEventListener(Player.ONLINE, () => { if (!cancelled) setOffline(false); });
        // The whole point of the interactive embed: react to the channel dropping.
        player.addEventListener(Player.OFFLINE, () => { if (!cancelled) setOffline(true); });
      })
      .catch(() => {
        if (!cancelled) { setOffline(true); setLoading(false); }
      });
    return () => {
      cancelled = true;
      try { if (player && player.destroy) player.destroy(); } catch { /* ignore */ }
    };
  }, [channel, parent]);

  const playerSrc = playerEmbedSrc(channel, parent);

  return (
    <div
      className="relative w-full aspect-video bg-black rounded-card overflow-hidden border border-white/10"
      data-testid="twitch-video-embed"
      data-channel={channel}
      data-parent={parent}
      data-player-src={playerSrc}
    >
      <div id={holderRef.current} className="absolute inset-0" />
      {loading && !offline && (
        <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">Loading stream…</div>
      )}
      {offline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center px-4" data-testid="twitch-video-offline">
          <span className="text-white font-heading font-bold">This channel is offline</span>
          <span className="text-white/50 text-xs max-w-sm">
            The Twitch stream ({channel}) went offline or its player couldn’t load. The market below still works normally.
          </span>
        </div>
      )}
    </div>
  );
}
