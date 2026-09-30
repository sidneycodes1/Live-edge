// Pure Twitch embed URL/param builders — shapes verified against the official
// embed docs (cited) and unit-tested (server/test/twitch-embed.test.js) so the
// exact `channel` / `parent` params are proven without a browser/network.
//
// Chat iframe:  https://dev.twitch.tv/docs/embed/chat/
//   https://www.twitch.tv/embed/<channel>/chat?parent=<parent>
// Player iframe (params identical to the interactive player we mount):
//   https://dev.twitch.tv/docs/embed/video-and-clips/
//   https://player.twitch.tv/?channel=<channel>&parent=<parent>&muted=true&autoplay=true
//
// `parent` is the bare hosting domain (no protocol) — one parent per serving domain.

// A Twitch login is [a-z0-9_]{1,25} + the `_` prefix edge cases; be permissive but
// reject obvious garbage (spaces, slashes, empty) so we never build a nonsense URL.
export function isValidTwitchLogin(login) {
  return typeof login === 'string' && /^[a-z0-9][a-z0-9_]{0,24}_?$/i.test(login);
}

export function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

export function chatEmbedSrc(channel, parent) {
  const c = normalizeLogin(channel);
  if (!c || !parent) return '';
  return `https://www.twitch.tv/embed/${encodeURIComponent(c)}/chat?parent=${encodeURIComponent(parent)}`;
}

export function playerEmbedSrc(channel, parent, { autoplay = true, muted = true } = {}) {
  const c = normalizeLogin(channel);
  if (!c || !parent) return '';
  const u = new URL('https://player.twitch.tv/');
  u.searchParams.set('channel', c);
  u.searchParams.set('parent', parent);
  u.searchParams.set('muted', String(muted));
  u.searchParams.set('autoplay', String(autoplay));
  return u.toString();
}

// Options passed to the interactive window.Twitch.Player (the documented form
// that fires OFFLINE/ONLINE events). parent is an array for the JS embed.
export function buildPlayerOptions(channel, parent) {
  return {
    width: '100%',
    height: '100%',
    channel: normalizeLogin(channel),
    parent: [parent],
    autoplay: true,
    muted: true,
  };
}
