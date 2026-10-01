# Live Aggregation — Frozen Spec (Source of Truth)

> **STATUS: FROZEN.** This file is the shared contract every agent codes against.
> Do **not** edit it in a feature branch. Request changes through the **verifier**,
> who amends it here on the base branch and re-freezes. If code on disk disagrees
> with this file, the disagreement is a bug to raise — not a license to silently
> diverge in either direction.
>
> **Anti-hallucination rule (all agents):** every claim you ship is tagged
> `VERIFIED (how you confirmed it)` or `NOT VERIFIED (why)`. "Looks right" is not
> VERIFIED. A criterion is VERIFIED only when you ran something that proves it.

---

## 0. Purpose

Turn the single-source Twitch live feed into a **multi-provider live grid** that is
**fast** (server-cache answers the browser immediately), **never-empty** (the
fallback ladder always yields ≥1 card when anything is configured), and
**honest** (real vs demo vs stale is visible; nothing is fabricated). The betting /
portfolio / resolution layer already exists and is **out of scope** — this round is
streaming aggregation + the football watch-party vertical + UI polish.

---

## 1. `LiveChannel` — the single merged shape

Defined in code by `server/src/aggregator/schema.js` → `makeLiveChannel()`. That
module is the authority for the field list; this section documents meaning.

```
LiveChannel {
  id           // "<source>:<nativeId>" — namespaced so two shapes never collide
               //   and stale-cache dedupe is stable across refetches
  source       // 'twitch' | 'kick' | 'youtube' | 'floor' | '' (unknown, clamped)
  title        // stream / video title (source-native string, never invented)
  channelName  // human handle / channel title as the provider labels it
  channelSlug  // the login/slug/channelId the embed URL is built from
  category     // SOURCE-NATIVE label only (Twitch game_name, Kick category.name,
               //   YouTube '', floor config tag). NEVER an invented bucket.
  viewerCount  // integer ≥ 0 (0 when the provider exposes none — see §4 honesty)
  startedAt    // ISO string | null
  thumbnailUrl // provider thumbnail | '' (empty renders a "no preview" tile —
               //   we never fabricate a URL that could 404)
  isLive       // boolean (true at the grid boundary: only live rows are surfaced)
  isMature     // boolean (age-gate signal for the UI)
  watchUrl     // canonical provider page (https://…/…) | null
  language     // provider language | null
}
```

Rules:
- **Every field has a safe default.** A partially-populated provider row still
  renders; the grid never sees `undefined`.
- `LIVE_SOURCES = ['twitch', 'kick', 'youtube', 'floor']` (schema.js). Unknown
  `source` values clamp to `''` so the ladder's per-source accounting stays honest.
- **Embed + chat URLs are NOT stored on the channel.** They are built by the
  frontend from `source` + `channelSlug`/`watchUrl` (+ `parent` domain from
  `/api/config`). This keeps the shared shape lean and lets each source's embed
  quirks live in one frontend map (§6). See §6 for which embeds are VERIFIED vs
  to-confirm.

---

## 2. Category taxonomy + the football vertical

- The grid's category chips are derived from **observed** `LiveChannel.category`
  values plus a **fixed display superset**; we do not invent per-row buckets
  (matches the existing rule in `web/src/pages/Discover.jsx`).
- **Display categories (chips):** `Football`, `Sports`, `Gaming`, `IRL`, `Music`,
  `Talk`, `Tech/Conference`, `Lifestyle`. A chip only shows a rail if data exists
  for it; empty rails are hidden (never a blank "Football" section).

### Football = watch-party vertical (CONFIRMED framing)

- Football is **NOT a hosted live-video provider.** Premium match footage is
  licensed; we do not embed or scrape pirated re-streams.
- A football surface at LiveEdge is a **watch-party room**: our own `rooms`/markets
  about a match, with live chat + odds + the recent-bets ticker, and a
  **"bring your own feed / where to watch"** video panel (the fan's legal TV or
  subscription). No hosted stream.
- Optionally, genuinely-embeddable football **talk/analysis/press-conference** live
  channels (via the YouTube provider query) may appear in the Football rail — that
  is real, legal, third-party content, not match video.
- In the grid data, football rows are tagged by a room/`category` marker owned by
  Agent C (data), not by a live provider. The **landing rail order** is:
  `Featured (live now)` → `⚽ Live Football` → `🔥 Trending bets` → `⏳ Closing soon`
  → category chips → `Movers`.
- Markets for football resolve on the **existing sim/hybrid** path (demo
  settlement, honestly labeled). Live sports-data settlement is a future item, not
  this round.

---

## 3. The never-empty ladder

Implemented by `server/src/aggregator/index.js` → `createLiveAggregator()`
(**OPEN** — file does not exist yet). Composition contract:

```
createLiveAggregator({ twitch, kick, youtube, floor, cacheTtlMs = 30000, now, warn })
  .getLive({ limit }) -> LiveResponse   // never throws
```

Priority order (earliest wins merge order, later rungs fill when earlier are empty):

```
Twitch  →  Kick  →  YouTube  →  stale cache  →  floor guaranteed channel  →  empty
```

Algorithm (must match tests):
1. Run each enabled source's `getTopLiveChannels(limit)` through its
   `providerRunner.runSafe()` (§5) **in parallel** (bulkhead caps each source).
2. Merge the `ok:true` results in ladder order, **de-dupe by `id`**.
3. If merged length is **0**:
   - serve the last-good merged cache (even if past TTL) → `servedFrom: 'stale'`;
   - if there is no cache, emit `floor.getGuaranteedChannel()`
     (`source: 'floor'`, network-free, only when `FLOOR_FALLBACK_URL` is set)
     → `servedFrom: 'floor'`;
   - if floor is unconfigured too → `items: []`, `servedFrom: 'empty'`
     (**honest empty — we never fabricate a stream that might not play**).
4. Cache the merged result for `cacheTtlMs` (grid cache; separate from each
   client's own per-provider cache).

### `/api/live` response shape (public, never 500s — mirrors `/api/twitch`)

```
{
  items: LiveChannel[],
  count: number,
  servedFrom: 'live' | 'stale' | 'floor' | 'empty',
  generatedAt: ISO string,
  sources: {
    twitch:  { enabled, ok, count, degraded, reason? },
    kick:    { enabled, ok, count, degraded, reason? },
    youtube: { enabled, ok, count, degraded, reason? },
    floor:   { enabled, ok, count, degraded, reason? }
  }
}
```
`reason` carries the `ProviderError.code` (§5) when degraded, so the UI can show an
honest "using last results / demo floor" state instead of a blank.

---

## 4. Honesty invariants (non-negotiable)

- **No fabricated social proof.** `viewerCount` comes only from a provider that
  exposes it; sources that don't (Kick livestreams, YouTube search-only) yield `0`,
  and the UI shows "—" not a made-up number.
- **No fabricated thumbnails.** Empty `thumbnailUrl` renders a neutral "no preview"
  tile; we never point at a guessed image (`via.placeholder.com` is banned).
- **Real vs stale vs demo is visible** via `servedFrom` + per-source `degraded`.
- **Money marker unchanged.** The `Play` honesty marker and integer micro-unit money
  math are untouched by this work.

---

## 5. Resilience primitives

Implemented in `server/src/aggregator/resilience.js` (**DONE**). Single source of
truth for budgets:

```
TIMEOUT_MS          = 2500
RETRIES             = 1        // immediate, no backoff (fast 2nd try beats waiting)
BREAKER_THRESHOLD   = 3        // consecutive failures → open
BREAKER_COOLDOWN_MS = 30000    // 30s, then half-open single probe
BULKHEAD_LIMIT      = 3        // per provider, fail-fast on the grid path
```

Wrapping order (outside → inside):
`bulkhead(fail-fast) → circuit-breaker → retry → timeout → real fetch thunk`.
Rationale (in code): a saturated provider sheds load immediately; a rejected call
never wrongly counts toward the failure budget; one transient blip doesn't trip the
breaker; the original attempt and its one retry each get their own timeout budget.

- `isRetryable`: TIMEOUT, NETWORK, HTTP 5xx only. **Never** 4xx / MISSING_CREDENTIALS
  / CIRCUIT_OPEN / BULKHEAD_REJECTED.
- `createProviderRunner().runSafe(thunk, fallback)` → `{ ok, value, degraded, reason }`
  so **no single provider can 500 the grid**.

### Error taxonomy — `server/src/aggregator/errors.js` → `ProviderError` (**DONE**)

`code` is part of the contract (drives the retry classifier + the UI's degraded
reporting); keep values stable.

```
MISSING_CREDENTIALS   no creds → client returns [] without touching network
NETWORK               transport threw — retryable
TIMEOUT               exceeded budget — retryable
HTTP_ERROR            non-2xx; .status carried (>=500 retryable)
CIRCUIT_OPEN          breaker open; not retried; source degraded
BULKHEAD_REJECTED     concurrency cap (fail-fast); not retried
```

---

## 6. Providers — endpoints (verified in code) + embed handling

Client boundaries **never throw**; missing creds / upstream failure degrade to `[]`
+ a warning; the secret is **never logged**. `category` is passed through
source-native. Endpoint citations live in each client's header comment.

| Provider | Discovery (VERIFIED against cited docs) | Embed (frontend responsibility) |
|---|---|---|
| **Twitch** (exists) | Helix `GET /streams` + app-token client-credentials | `https://player.twitch.tv/?channel=<slug>&parent=<domain>` — VERIFIED |
| **Kick** (client **DONE**) | `POST https://id.kick.com/oauth/token` (client-credentials) + `GET https://api.kick.com/public/v1/livestreams` | `https://player.kick.com/<slug>` — **NOT VERIFIED** (confirm embed + chat widget in the browser before relying on it) |
| **YouTube** (client **DONE**) | Data v3 `search?eventType=live` then `videos?part=liveStreamingDetails` (API key) | `https://www.youtube.com/embed/<videoId>` — VERIFIED (standard) |
| **Floor / Livepeer** (client **DONE**) | optional `GET https://api.livepeer.com/studio/streams`; guaranteed network-free channel from env | HLS `watchUrl` played directly (`<video>`/hls.js) — **NOT VERIFIED** in-browser yet |

**Open frontend items:** Kick embed/chat + Livepeer HLS playback must be proven in a
real browser and tagged VERIFIED before they ship in the demo path. Until then treat
them as best-effort with the floor/empty fallback behind them.

---

## 7. Config & env (server) — additive, all optional → degrade like Twitch

Existing (`config/env.js`): `TWITCH_CLIENT_ID/SECRET/FALLBACK_CHANNEL/PARENT_DOMAIN/CACHE_TTL_MS`,
already surfaced via `/api/config` as `{ twitch: { enabled, parent } }`.

**Add (env.js, zod, optional; each absent key disables its source, no boot error):**

```
KICK_CLIENT_ID, KICK_CLIENT_SECRET, KICK_CACHE_TTL_MS
YOUTUBE_API_KEY, YOUTUBE_QUERY
FLOOR_PROVIDER (=livepeer), LIVEPEER_API_KEY, FLOOR_HLS_BASE,
  FLOOR_FALLBACK_URL, FLOOR_FALLBACK_TITLE, FLOOR_FALLBACK_CHANNEL, FLOOR_FALLBACK_CATEGORY
LIVE_CACHE_TTL_MS   (grid cache, default 30000)
```

**Extend `/api/config`** (keep current `twitch` key for back-compat):

```
features: { twitchLive, kickLive, youtubeLive, floorLive },   // booleans from creds
twitch: { enabled, parent },                                   // unchanged
kick:    { enabled },
youtube: { enabled },
floor:   { enabled, hlsBase }
```
Only ever exposes `enabled`/`parent`/`hlsBase` — **never** a secret or a token.

---

## 8. Auth posture — unchanged (already senior-grade)

Signature-MAC'd short-lived JWT (pinned `alg`), Ed25519 nonce login, scrypt,
timing-equalized login, per-route authorization, secrets never logged. Provider
credentials are **server-side only**; the browser sees `enabled` flags, never keys.
No auth changes this round.

---

## 9. Ownership map (who does what)

- **Lead / Verifier (base branch):** this spec; the scaffold commit; worktrees; the
  verification gate; merges.
- **Agent A — Backend (`feat/live-aggregation`):** `aggregator/index.js` (the ladder
  §3), `routes/live.js` (`/api/live` §3), `env.js` keys + `/api/config` flags (§7),
  wire into `app.js`, `services` construction of kick/youtube/floor clients with
  provider runners. Clients already exist — extend, don't rebuild.
- **Agent B — Frontend (`feat/live-ui-football`):** consume `/api/live`; provider-
  agnostic cards + embed map (§6); football `⚽` rail + watch-party room + category
  chips (§2); never-empty / degraded / stale states (§4). **UI/UX Pro Max (Qoder)**
  as the sole style engine; persist `design-system/liveedge/MASTER.md` first.
- **Agent C — Data (`feat/live-data`):** `rooms.category`/`source`/`watch_party`
  binding for football; deterministic seed across football + gaming + lifestyle;
  per-provider fixtures. No time-based nondeterminism.
- **Agent D — QA (`test/live-qa`):** mocked-fetch contract tests per client;
  resilience tests (timeout→retry, breaker open→ladder, bulkhead reject); a test
  proving the grid is **non-empty when 3 of 4 sources fail**; Playwright: a Kick +
  a YouTube room render + a bet still confirms; Football rail renders on landing.
  Never weaken an existing test/guard to pass.

---

## 10. Commit & branch discipline

- Conventional Commits **with an agent scope tag** so the verifier can attribute
  work from the log: `feat(kick):`, `feat(youtube):`, `feat(floor):`,
  `feat(aggregator):`, `feat(ui):`, `feat(data):`, `test(qa):`, `docs(live):`.
- One logical change per commit; body explains *why*; small and frequent.
- Every commit green on `pnpm lint` + `pnpm build` + `pnpm test` (server) + the four
  Playwright suites at the verifier gate. **No test/guard weakened** to get green —
  a red you can't fix is a `NOT VERIFIED (why)` escalation, not a `describe.skip`.
- No secrets in code, logs, or commits (pre-commit `check-secrets` guard runs).
- Agents commit **locally on their own worktree branch only**. No push to origin
  until the verifier has checked out that branch and re-run everything.
