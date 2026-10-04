// ---------------------------------------------------------------------------
// Frontend adapter for GET /api/live (the LiveChannel grid).
//
// This module ONLY normalizes/reads the frozen contract in
// docs/live-aggregation-spec.md §1 (LiveChannel) + §3 (/api/live response).
// It never fabricates a field: every value falls back to the same safe default
// the server schema (server/src/aggregator/schema.js) guarantees, so the grid
// can never render `undefined` and never invents a number/thumbnail (§4 honesty).
//
// The on-disk route currently returns the ladder as boolean flags
// (usedStale / usedFloor / empty) + a numeric generatedAt, while the frozen spec
// §3 describes `servedFrom` + an ISO generatedAt. We support BOTH shapes so a
// later route alignment is a no-op here — the divergence is raised through the
// verifier rather than silently patched on either side.
// ---------------------------------------------------------------------------

export const LIVE_SOURCES = ['twitch', 'kick', 'youtube', 'floor', 'curated-youtube'];

const SOURCE_SET = new Set(LIVE_SOURCES);

function str(v) { return v == null ? '' : String(v); }
function int(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; }
// §4 honesty: a provider that exposes NO viewer count must stay null (render
// nothing) — never coerced to a fake 0. Only a real numeric count survives.
function optInt(v) { return v == null ? null : int(v); }

// Normalize one LiveChannel defensively (fields already defaulted server-side;
// this keeps the UI honest even against a partial/degraded row). Curated 24/7
// rows carry extra real fields (videoUrl/liveEmbedUrl/owner/status) and NO
// viewerCount — we pass the extras through and leave viewerCount null (§4).
export function normalizeChannel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = SOURCE_SET.has(raw.source) ? raw.source : '';
  return {
    id: str(raw.id),
    source,
    title: str(raw.title),
    channelName: str(raw.channelName),
    channelSlug: str(raw.channelSlug),
    category: str(raw.category),
    viewerCount: optInt(raw.viewerCount),
    startedAt: raw.startedAt == null ? null : str(raw.startedAt),
    thumbnailUrl: str(raw.thumbnailUrl),
    isLive: Boolean(raw.isLive),
    isMature: Boolean(raw.isMature),
    watchUrl: raw.watchUrl == null ? null : str(raw.watchUrl),
    language: raw.language == null ? null : str(raw.language),
    // Curated / provider passthrough (empty for rows that don't carry them).
    videoUrl: raw.videoUrl == null ? '' : str(raw.videoUrl),
    liveEmbedUrl: raw.liveEmbedUrl == null ? '' : str(raw.liveEmbedUrl),
    owner: raw.owner == null ? '' : str(raw.owner),
    status: raw.status == null ? '' : str(raw.status),
  };
}

// Which rung of the never-empty ladder served this response (§3/§4). Prefers an
// explicit `servedFrom` when the route provides it, else derives from the flags.
export function deriveServedFrom(raw, count) {
  const allowed = ['live', 'stale', 'floor', 'empty'];
  if (raw && allowed.includes(raw.servedFrom)) return raw.servedFrom;
  if (raw?.usedStale) return 'stale';
  if (raw?.usedFloor) return 'floor';
  if (!count) return 'empty';
  return 'live';
}

function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const s = String(v);
  return s || null;
}

// Turn the raw /api/live payload into a stable, render-ready view model.
export function normalizeLive(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map(normalizeChannel)
    .filter(Boolean);
  const count = typeof raw?.count === 'number' ? raw.count : items.length;
  return {
    items,
    count,
    servedFrom: deriveServedFrom(raw, count),
    generatedAt: toIso(raw?.generatedAt),
    enabled: raw?.enabled && typeof raw.enabled === 'object' ? raw.enabled : {},
    sources: raw?.sources && typeof raw.sources === 'object' ? raw.sources : {},
    degraded: Array.isArray(raw?.degraded) ? raw.degraded : [],
  };
}

// A grid is only "real live" when it served fresh provider rows; stale/floor/empty
// drive an honest status label instead of a blank (§4). Never a fabricated state.
export function isFreshLive(view) {
  return view?.servedFrom === 'live' && view.count > 0;
}

// ---------------------------------------------------------------------------
// Football DATA feed (GET /api/live?category=football). A deliberately NARROWER
// shape than a LiveChannel — a fixture has NO broadcast art and NO viewer count
// by design (server/src/football/client.js). We normalize it on its OWN path so
// a match never leaks through normalizeChannel (which would clamp its source and
// could imply a viewer count). §4: videoUrl/thumbnailUrl stay null; never fake.
// ---------------------------------------------------------------------------
export function normalizeMatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title);
  const dash = title.indexOf('\u2013'); // en-dash between the two team names
  const home = dash >= 0 ? title.slice(0, dash).trim() : title;
  const away = dash >= 0 ? title.slice(dash + 1).trim() : '';
  const score = raw.score && typeof raw.score === 'object'
    ? { home: raw.score.home ?? null, away: raw.score.away ?? null }
    : null;
  return {
    id: str(raw.id),
    source: 'football-api',
    category: 'Football',
    title,
    home,
    away,
    league: str(raw.league),
    country: str(raw.country),
    status: raw.status == null ? null : str(raw.status),
    minute: raw.minute == null ? null : raw.minute,
    score,
    videoUrl: null,
    thumbnailUrl: null,
  };
}

export function normalizeFootballFeed(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : []).map(normalizeMatch).filter(Boolean);
  const count = typeof raw?.count === 'number' ? raw.count : items.length;
  const allowed = ['live', 'stale', 'empty', 'disabled'];
  const servedFrom = raw && allowed.includes(raw.servedFrom) ? raw.servedFrom : (count ? 'live' : 'empty');
  return { items, count, servedFrom };
}
