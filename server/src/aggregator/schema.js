// ---------------------------------------------------------------------------
// LiveChannel — the single merged shape GET /api/live returns, from every source.
//
// CONTRACT: docs/live-aggregation-spec.md §1 (LiveChannel) + §2 (taxonomy) are the
// frozen authority (present in-repo since ba5753b). This module stayed an
// additive superset of the original shipped provider shape, so nothing
// downstream breaks. Edits here are NOT spec changes: if
// code and §1 ever diverge, reconcile through the verifier (who owns the spec),
// never by silently rewriting either side.
//
// `category` carries the SOURCE-NATIVE label only (Kick category name, YouTube
// title/topic, floor tag) — never an invented bucket, matching the
// frontend rule in web/src/pages/Discover.jsx ("no invented taxonomy").
// ---------------------------------------------------------------------------

// Twitch retired as a provider Oct 2026 (Kick is the primary real-stream source);
// the wire key set shrank from 4 to 3. docs/live-aggregation-spec.md §1 still
// lists the original four — this line is the amendment of record.
export const LIVE_SOURCES = ['kick', 'youtube', 'floor'];

// bucket is a UI ROUTING KEY only (docs/BUILD_CONTRACT-browse-ui-chat.md sec 2a/3): it
// groups a live channel into one landing section and NEVER replaces the source-native
// category. The set is closed - any value outside it clamps to 'other', so an invented
// bucket can never reach the wire (sec 1 honesty).
export const LIVE_BUCKETS = ['news', 'sports', 'irl', 'games', 'other'];

// Deterministic Kick category -> bucket keyword table (sec 3). Applied to the LOWERCASED
// source-native category; FIRST MATCH WINS in the order news -> games -> sports -> irl,
// else 'other'. This is a fixed table, not a per-channel guess.
const BUCKET_KEYWORDS = [
  ['news', ['news', 'journalis', 'talkshow', 'politics', 'sporting news']],
  ['games', ['gaming', 'game', 'valorant', 'fortnite', 'minecraft', 'gta', 'apex', 'cs2',
    'counter-strike', 'league', 'rocket league', 'forza', 'ea fc', 'efootball', 'arc raiders', 'call of duty']],
  ['sports', ['sports', 'football', 'soccer', 'basketball', 'nba', 'ufc', 'boxing', 'cricket',
    'tennis', 'golf', 'hockey', 'racing']],
  ['irl', ['irl', 'just chatting', 'chatting', 'travel', 'outdoor', 'food', 'music', 'art',
    'creative', 'asmr', 'talk']],
];

// PURE: maps any raw category string to one of LIVE_BUCKETS. Never throws; a null/empty
// category is 'other'. Kick rows only - YouTube/floor rows stay 'other'.
export function bucketForCategory(category) {
  const c = String(category == null ? '' : category).toLowerCase();
  if (!c) return 'other';
  for (const [bucket, keywords] of BUCKET_KEYWORDS) {
    if (keywords.some((k) => c.includes(k))) return bucket;
  }
  return 'other';
}

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
  bucket = 'other',
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
    bucket: LIVE_BUCKETS.includes(bucket) ? bucket : 'other',
  };
}
