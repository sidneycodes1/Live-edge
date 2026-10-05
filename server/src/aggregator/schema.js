// ---------------------------------------------------------------------------
// LiveChannel — the single merged shape GET /api/live returns, from every source.
//
// CONTRACT: docs/live-aggregation-spec.md §1 (LiveChannel) + §2 (taxonomy) are the
// frozen authority (present in-repo since ba5753b). This module is a faithful,
// additive superset of the ALREADY-SHIPPED twitch shape (../twitch/client.js
// normalizeStream) so nothing downstream breaks. Edits here are NOT spec changes: if
// code and §1 ever diverge, reconcile through the verifier (who owns the spec),
// never by silently rewriting either side.
//
// `category` carries the SOURCE-NATIVE label only (Twitch game_name, Kick category
// name, YouTube title/topic, floor tag) — never an invented bucket, matching the
// frontend rule in web/src/pages/Discover.jsx ("no invented taxonomy").
// ---------------------------------------------------------------------------

export const LIVE_SOURCES = ['twitch', 'kick', 'youtube', 'floor'];

function str(v) {
  return v == null ? '' : String(v);
}
function int(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

// Namespaced id so the same real channel surfaced by two shapes never collides and
// so stale-cache dedupe is stable across refetches.
export function channelId(source, nativeId) {
  return `${source}:${str(nativeId)}`;
}

// Fill any LiveChannel from a source's raw mapping. Every field has a safe default
// so a partially-populated provider response still renders (never `undefined` in
// the grid). `source` must be one of LIVE_SOURCES; unknown sources are clamped to
// '' rather than silently passing through, to keep the ladder's accounting honest.
export function makeLiveChannel({
  source,
  nativeId,
  title,
  channelName,
  channelSlug,
  category,
  viewerCount,
  startedAt,
  thumbnailUrl,
  isLive = true,
  isMature = false,
  watchUrl,
  language,
} = {}) {
  const src = LIVE_SOURCES.includes(source) ? source : '';
  return {
    id: src ? channelId(src, nativeId) : str(nativeId),
    source: src,
    title: str(title),
    channelName: str(channelName),
    channelSlug: str(channelSlug),
    category: str(category),
    viewerCount: int(viewerCount),
    startedAt: startedAt == null ? null : str(startedAt),
    thumbnailUrl: str(thumbnailUrl),
    isLive: Boolean(isLive),
    isMature: Boolean(isMature),
    watchUrl: watchUrl == null ? null : str(watchUrl),
    language: language == null ? null : str(language),
  };
}
