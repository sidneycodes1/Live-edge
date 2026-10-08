// Pure Kick embed/URL builders — shapes verified against the official Kick
// Developer docs (cited) and unit-tested (web/src/lib/embed.test.js +
// server/test/kick.test.js) so the exact params are proven without a browser.
//
// Video iframe (docs.kick.com "Embed a Kick stream"):
//   https://player.kick.com/<channel>?autoplay=true&muted=true
//   — NO `parent` handshake is needed (unlike Twitch's domain registration);
//     the same player URL works on any hosting origin.
// Chat: Kick exposes NO official chat-only embed. The honest surface is the
// channel page itself (https://kick.com/<channel>), where signed-in viewers
// chat — so we link out instead of framing (§4: never pretend we host chat).

// Kick channel slugs are lowercase alphanumerics with '-' (occasionally '_');
// be permissive but reject obvious garbage (spaces, slashes, empty) so we
// never build a nonsense URL.
export function isValidKickSlug(slug) {
  return /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(normalizeSlug(slug));
}

export function normalizeSlug(slug) {
  return String(slug || '').trim().toLowerCase().replace(/^@/, '');
}

export function playerEmbedSrc(channel, { autoplay = true, muted = true } = {}) {
  const c = normalizeSlug(channel);
  if (!c) return '';
  const u = new URL(`https://player.kick.com/${encodeURIComponent(c)}`);
  u.searchParams.set('autoplay', String(autoplay));
  u.searchParams.set('muted', String(muted));
  return u.toString();
}

// Canonical channel page — the link-out target for real Kick chat.
export function channelWatchUrl(channel) {
  const c = normalizeSlug(channel);
  return c ? `https://kick.com/${encodeURIComponent(c)}` : '';
}
