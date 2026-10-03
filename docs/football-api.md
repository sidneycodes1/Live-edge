# Football Data API (Phase 1 — Football Live Bets Overhaul)

Backend-only integration of **API-Football** (api-sports.io v3, free plan ≈ 100
requests/day) as a **sports-data** source for the `category=football` feed. This
documents the contract implemented on `feat/football-api-data`; the frozen
`docs/live-aggregation-spec.md` §1–§10 is **not** edited here (feature branches do
not amend the frozen spec — changes go through the verifier).

## Why a separate doc

`docs/live-aggregation-spec.md` §3 defines the **generic multi-source live grid**
envelope (`sources` = an object of `{ twitch, kick, youtube, floor }`). Football is
NOT a live-video provider: it is match data (who plays, the minute, the score). It
therefore gets its own, deliberately-narrower envelope and this companion doc rather
than mutating the frozen §3 contract. §4 (honesty) still applies in full.

## Configuration (`server/src/config/env.js`)

Strict, optional, never crashes boot — the same degrade policy as every live provider (§7):

| Var | Default | Effect |
|---|---|---|
| `FOOTBALL_API_PROVIDER` | (unset) | must equal `api-football` or the feature is **disabled** (startup warning) |
| `FOOTBALL_API_KEY` | (unset) | missing → **disabled**; a secret — never logged/echoed, never committed |
| `FOOTBALL_API_BASE_URL` | `https://v3.football.api-sports.io` | API base |
| `SIM_BET_WINDOW_MIN` | `30` | positive integer; malformed → falls back to `30` with a warning |

`loadEnv` derives `footballApiEnabled = provider === 'api-football' && key present`.

## Client (`server/src/football/client.js`)

- `getLiveFixtures()` → `GET {base}/fixtures?live=all` (header `x-apisports-key`).
- `getTodayFixtures(date)` → `GET {base}/fixtures?date=YYYY-MM-DD`.
- **Cache / budget** (free plan is metered):
  - live TTL 20 min; a HARD budget guard refuses any refetch **< 19 min** after the
    last real hit (serves cache even if past TTL) → ≤ ~75 live requests/day (≤ 80).
  - today TTL 6 h per date → ≤ 4/day (≤ 8).
  - single-flight: concurrent callers share one in-flight request.
- **Error model** = `ProviderError` codes (`../aggregator/errors.js`): `DISABLED`,
  `TIMEOUT` (~8 s via `AbortController`), `RATE_LIMIT` (HTTP 429), `HTTP_ERROR`
  (other non-2xx), `NETWORK`. Public methods **may throw** (unlike the video
  clients): on transient failure **with** a cache the method returns the last-good
  data flagged `stale:true`; on failure with **nothing** cached it throws and the
  caller decides the fallback.
- **Item shape** (exact, no invented fields):
  ```
  { id:'match-<fixtureId>', source:'football-api', category:'Football',
    title:'<home> – <away>', league, country, kickOff:<ISO>, status:<fixture.status.short>,
    minute,                 // 1H|2H → elapsed, HT → 45, FT → 'FT', else null
    score,                  // { home, away } | null (null pre-kickoff / no goals)
    videoUrl:null, thumbnailUrl:null }   // video attach is a later phase
  ```
  **No `viewCount`/`viewerCount` key at all** (§4: we have no viewer data — never
  fabricate one, not even 0).

## Aggregator (`server/src/aggregator/index.js`)

`getFootballMatches(limit = 12)` → `{ items, status, generatedAt }`.
- Enabled only when `enabled.football` + a football client are present; otherwise
  `status:'disabled'`.
- **Priority-league ordering** (prefix, case-insensitive + accent-stripped), then
  everything else after in stable `kickOff` order, capped at `limit`:
  `UEFA Nations League, UEFA Champions League, Europa League, Conference League,
  Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga,
  Championship`.
- **No never-empty floor ladder**: an empty football result is an **honest empty** —
  a config floor stand (built for the generic grid) is never substituted, because
  that would be a fabricated football card.

## Route (`server/src/routes/live.js`)

`GET /api/live?category=football` →
```
{ items, count, servedFrom: 'live'|'stale'|'empty'|'disabled', generatedAt:<ISO>,
  sources: ['football-api'] }
```
- Disabled or empty → `items: []` honestly (no floor substitution), matching the
  football contract.
- The generic `GET /api/live` (no category, or a non-football category) is
  **byte-compatible** with the existing §3 grid — football items do NOT leak into it
  in this phase.

## Honesty (§4)

- `servedFrom` truthfully reports `live` / `stale` / `disabled` / `empty`; a hard
  failure never masquerades as `live`.
- Scores/minutes/teams/leagues come only from the provider; nothing is inferred.
- The API key is server-side only and never crosses the wire or the logs.
