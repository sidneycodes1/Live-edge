// ---------------------------------------------------------------------------
// Side-rail channel list builder (the component fetches, this composes — pure,
// so the merge/dedupe rules are provable without a DOM).
//
// Order mirrors the old inline logic: real Kick streams (/api/kick/live, the
// platform's primary real-stream source since the Twitch retirement) → platform
// rooms (demo seeds NEVER pollute the rail) → the real live-grid channels from
// /api/live. A live-grid channel whose title already matches a room is skipped:
// engine rooms are BORN from those broadcasts, and showing "49ers vs Broncos"
// twice (room + raw channel) reads like a broken list, not a busy one.
// ---------------------------------------------------------------------------
const norm = (v) => String(v || '').toLowerCase().trim();

export function buildRailEntries({ kick = [], rooms = [], live = [], liveHref = null, limit = 14 } = {}) {
  // Kick rows arrive as normalized LiveChannels (the client maps them at the
  // source), so slug/name/viewers come straight off the shared shape.
  const kickEntries = kick.map((c) => ({
    key: `k-${c.id}`, to: `/watch/kick/${encodeURIComponent(c.channelSlug || c.id || '')}`,
    name: c.channelName || c.title || c.channelSlug, sub: c.title || 'Live on Kick',
    viewers: c.viewerCount || 0, real: true,
  }));
  const roomEntries = rooms
    .filter((r) => !r.isSeed)
    .map((r) => ({
      key: `r-${r.id}`, to: `/room/${r.id}`,
      name: r.title, sub: r.owner?.displayName || 'LiveEdge',
      viewers: r.viewers || 0, real: false,
    }));
  const seen = new Set(roomEntries.map((e) => norm(e.name)));
  const liveEntries = live
    .map((c) => ({
      key: `l-${c.id}`,
      to:
        (liveHref ? liveHref(c) : null) ||
        `/watch/${encodeURIComponent(c.source || 'live')}/${encodeURIComponent(c.channelSlug || c.id || '')}`,
      name: c.title || c.channelName || 'Live stream',
      sub: c.channelName || 'Live',
      viewers: c.viewerCount || 0,
      real: true,
    }))
    // Dedupe by title only against ROOMS (kick entries keep their own lane —
    // a room and a raw Kick stream never share a title source).
    .filter((e) => !seen.has(norm(e.name)));
  return [...kickEntries, ...roomEntries, ...liveEntries].slice(0, limit);
}
