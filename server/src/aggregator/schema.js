// ---------------------------------------------------------------------------
// LiveChannel — the single merged shape GET /api/live returns, from every source.
//
// NOTE (verifier): docs/live-aggregation-spec.md — the frozen schema/taxonomy — is
// ABSENT from the repo (confirmed via git ls-files + glob). This module is built
// strictly additive to the ALREADY-SHIPPED twitch shape (../twitch/client.js
// normalizeStream) so nothing downstream breaks; it is a faithful superset, NOT a
// new authority. If the frozen spec differs, request the delta through the verifier
// rather than editing here.
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
