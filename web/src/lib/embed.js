// ---------------------------------------------------------------------------
// Provider-agnostic embed map (docs/live-aggregation-spec.md §6).
//
// Embed/chat URLs are the FRONTEND's job — they are built here from a
// LiveChannel's `source` + `channelSlug`/`watchUrl` (+ the `parent` domain from
// /api/config). Nothing is stored on the shared shape (§1).
//
// VERIFICATION STATUS is carried per-provider so the demo path never relies on an
// unproven embed: Twitch + YouTube embeds are VERIFIED (official docs, unit-tested
// URL construction); Kick + Livepeer-HLS are NOT VERIFIED in a real browser yet, so
// they are treated best-effort and gated behind the floor/external fallback (§6).
// ---------------------------------------------------------------------------

export const EMBED_VERIFIED = {
  twitch: true,   // https://dev.twitch.tv/docs/embed/video-and-clips/
  youtube: true,  // https://developers.google.com/youtube/iframe_api_reference
  kick: false,    // player.kick.com/<slug> — NOT VERIFIED in-browser yet
  floor: false,   // Livepeer HLS — playback implemented via hls.js (HlsVideo.jsx); browser verification pending
};

export function isEmbedVerified(source) {
  return Boolean(EMBED_VERIFIED[source]);
}

function trim(s) { return String(s == null ? '' : s).trim(); }

// The YouTube `channelSlug` is the CHANNEL id, not the video — the videoId lives in
// `watchUrl` (youtube.com/watch?v=…) or the namespaced `id` (youtube:<videoId>).
// Extract it so the embed points at the actual broadcast, never a guessed one.
export function extractYouTubeVideoId(channel) {
  const watch = trim(channel?.watchUrl);
  if (watch) {
    try {
      const u = new URL(watch);
      const v = u.searchParams.get('v');
      if (v) return v;
      // /embed/<id>, /shorts/<id>, /live/<id>, youtu.be/<id>
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (m) return m[1];
      if (u.hostname.endsWith('youtu.be')) {
        const seg = u.pathname.split('/').filter(Boolean)[0];
        if (seg) return seg;
      }
    } catch { /* fall through to id parsing */ }
  }
  const id = trim(channel?.id);
  if (id.startsWith('youtube:')) return id.slice('youtube:'.length);
  return '';
}

// The YouTube CHANNEL id (UC…). Curated 24/7 rows carry it in `liveEmbedUrl`
// (…/live_stream?channel=UC…); provider rows surface it as `channelSlug`. We read
// it so a channel-level watch URL can rebuild the always-live embed without a
// grid lookup. Returns '' when there is no genuine channel id (never a guess).
export function extractYouTubeChannelId(channel) {
  const live = trim(channel?.liveEmbedUrl);
  if (live) {
    const m = /[?&]channel=([\w-]+)/.exec(live);
    if (m) return m[1];
  }
  const slug = trim(channel?.channelSlug);
  if (/^UC[\w-]{20,}$/.test(slug)) return slug;
  return '';
}

// Result: { provider, verified, kind, src, watchUrl }
//  - kind 'iframe'  → safe to mount an <iframe src>
//  - kind 'hls'     → .m3u8 stream (needs hls.js; NOT VERIFIED → gated)
//  - kind 'external'→ we can't embed it here; open the canonical page instead
export function buildVideoEmbed(channel, parent) {
  const source = trim(channel?.source);
  const slug = trim(channel?.channelSlug);
  const watchUrl = channel?.watchUrl ? String(channel.watchUrl) : null;

  if (source === 'twitch' && slug && parent) {
    const u = new URL('https://player.twitch.tv/');
    u.searchParams.set('channel', slug.toLowerCase());
    u.searchParams.set('parent', parent);
    u.searchParams.set('muted', 'true');
    u.searchParams.set('autoplay', 'true');
    return { provider: 'twitch', verified: true, kind: 'iframe', src: u.toString(), watchUrl };
  }

  // Curated 24/7 channel: embed by CHANNEL id (live_stream?channel=UC…) so it
  // always plays whatever that channel is live-streaming right now — no per-video
  // discovery, no search quota. Falls back to the concrete video id if present.
  if (source === 'curated-youtube') {
    const live = trim(channel?.liveEmbedUrl);
    if (live) {
      return { provider: 'youtube', verified: true, kind: 'iframe', src: live, watchUrl: channel?.videoUrl || watchUrl };
    }
    const videoId = extractYouTubeVideoId({ watchUrl: channel?.videoUrl || watchUrl, id: '' });
    if (videoId) {
      const u = new URL(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`);
      u.searchParams.set('autoplay', '1');
      u.searchParams.set('mute', '1');
      u.searchParams.set('rel', '0');
      return { provider: 'youtube', verified: true, kind: 'iframe', src: u.toString(), watchUrl: channel?.videoUrl || watchUrl };
    }
  }

  if (source === 'youtube') {
    const videoId = extractYouTubeVideoId(channel);
    if (videoId) {
      const u = new URL(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`);
      u.searchParams.set('autoplay', '1');
      u.searchParams.set('mute', '1');
      u.searchParams.set('rel', '0');
      return { provider: 'youtube', verified: true, kind: 'iframe', src: u.toString(), watchUrl };
    }
  }

  if (source === 'kick' && slug) {
    // Best-effort: documented player host, but NOT proven in a browser here.
    const u = new URL(`https://player.kick.com/${encodeURIComponent(slug.toLowerCase())}`);
    u.searchParams.set('autoplay', 'true');
    u.searchParams.set('muted', 'true');
    return { provider: 'kick', verified: false, kind: 'iframe', src: u.toString(), watchUrl };
  }

  if (source === 'floor' && watchUrl && /\.m3u8($|\?)/i.test(watchUrl)) {
    // HLS playback is handled by HlsVideo.jsx (hls.js); surfaced for browser verification.
    return { provider: 'floor', verified: false, kind: 'hls', src: watchUrl, watchUrl };
  }

  // Nothing embeddable we can stand behind → offer the canonical page honestly.
  return { provider: source || '', verified: false, kind: watchUrl ? 'external' : 'none', src: '', watchUrl };
}

// Live chat. Twitch is verified (real Helix embed). YouTube exposes an official
// live_chat iframe keyed by the VIDEO id — we return it ONLY when a real video id
// is known. A channel-level curated 24/7 embed has no single video, so it returns
// null and the room shows an honest "chat unavailable" note — never a fake box.
// Kick chat is not available here → null (§4: say so plainly).
export function buildChatEmbed(channel, parent) {
  const source = trim(channel?.source);
  const slug = trim(channel?.channelSlug);
  if (source === 'twitch' && slug && parent) {
    return {
      provider: 'twitch',
      verified: true,
      src: `https://www.twitch.tv/embed/${encodeURIComponent(slug.toLowerCase())}/chat?parent=${encodeURIComponent(parent)}`,
    };
  }
  if (source === 'youtube') {
    const videoId = extractYouTubeVideoId(channel);
    if (videoId) {
      const u = new URL('https://www.youtube.com/live_chat');
      u.searchParams.set('v', videoId);
      u.searchParams.set('is_framed', 'true');
      return { provider: 'youtube', verified: true, kind: 'iframe', src: u.toString(), videoId };
    }
    return null;
  }
  if (source === 'curated-youtube') {
    // Chat only if a concrete current video id rides along; a pure channel (UC…)
    // embed has no stable video → honest null so the room can say chat is n/a.
    const videoId = extractYouTubeVideoId({ watchUrl: channel?.videoUrl, id: '' });
    if (videoId) {
      const u = new URL('https://www.youtube.com/live_chat');
      u.searchParams.set('v', videoId);
      u.searchParams.set('is_framed', 'true');
      return { provider: 'youtube', verified: true, kind: 'iframe', src: u.toString(), videoId };
    }
    return null;
  }
  return null;
}

// Detect a provider from a raw "bring your own feed" URL (watch-party room). Returns
// a buildVideoEmbed-shaped result using the URL itself (no LiveChannel needed).
export function detectEmbedFromUrl(url, parent) {
  const raw = trim(url);
  if (!raw) return { provider: '', verified: false, kind: 'none', src: '', watchUrl: null };
  let u;
  try { u = new URL(raw); } catch { return { provider: '', verified: false, kind: 'none', src: '', watchUrl: raw }; }
  const host = u.hostname.toLowerCase();

  if (/\.mp4($|\?)/i.test(u.pathname)) {
    return { provider: 'mp4', verified: true, kind: 'mp4', src: raw, watchUrl: raw };
  }
  if (/\.m3u8($|\?)/i.test(u.pathname)) {
    // Self-hosted / Livepeer HLS — played by HlsVideo.jsx (hls.js).
    return { provider: 'hls', verified: false, kind: 'hls', src: raw, watchUrl: raw };
  }
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    const videoId = extractYouTubeVideoId({ watchUrl: raw, id: '' });
    if (videoId) {
      const e = new URL(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`);
      e.searchParams.set('autoplay', '1'); e.searchParams.set('mute', '1'); e.searchParams.set('rel', '0');
      return { provider: 'youtube', verified: true, kind: 'iframe', src: e.toString(), watchUrl: raw };
    }
  }
  if (host.includes('twitch.tv')) {
    const slug = u.pathname.split('/').filter(Boolean)[0] || (host === 'www.twitch.tv' ? u.pathname.split('/').filter(Boolean)[0] : '');
    if (slug && slug !== 'embed' && parent) {
      const e = new URL('https://player.twitch.tv/');
      e.searchParams.set('channel', slug.toLowerCase()); e.searchParams.set('parent', parent);
      e.searchParams.set('muted', 'true'); e.searchParams.set('autoplay', 'true');
      return { provider: 'twitch', verified: true, kind: 'iframe', src: e.toString(), watchUrl: raw };
    }
  }
  if (host.includes('kick.com')) {
    const slug = u.pathname.split('/').filter(Boolean)[0];
    if (slug) {
      const e = new URL(`https://player.kick.com/${encodeURIComponent(slug.toLowerCase())}`);
      e.searchParams.set('autoplay', 'true'); e.searchParams.set('muted', 'true');
      return { provider: 'kick', verified: false, kind: 'iframe', src: e.toString(), watchUrl: raw };
    }
  }
  // Unknown source: never pretend it plays — offer the external page.
  return { provider: '', verified: false, kind: 'external', src: '', watchUrl: raw };
}
