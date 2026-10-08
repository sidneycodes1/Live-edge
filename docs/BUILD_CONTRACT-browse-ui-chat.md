# BUILD CONTRACT — Browse UI + LiveEdge Chat + Kick-first (Agents A/B/C)

> **Owner:** the verifier (coordinator). This is the shared source of truth for the
> three parallel build agents. Do **not** edit this file inside an agent branch —
> request changes through the verifier. If code and this doc disagree, that is a
> bug to raise, not a license to diverge.
>
> **Base branch:** `feature/browse-ui-and-chat` (off `feature/live-pins`, which now
> carries the committed Twitch→Kick swap `449bc39`). Each agent creates its **own
> git worktree + branch off this base**, builds only inside its lane, and reports
> back. The verifier merges A/B/C and runs the full gate set.

---

## 0. Product decisions (locked by the user)

1. **Kill "Sign in to chat".** That button lives *inside* YouTube's cross-origin
   `live_chat` iframe (`WatchRoom` → `ChatColumn`) and cannot be restyled/removed
   from our side. The fix is to **stop embedding provider chat** and use LiveEdge's
   own chat everywhere.
2. **Comments are LiveEdge's, not the provider's.** Users post to LiveEdge; the
   comment is stored server-side and shown to everyone. Posting requires sign-in
   (a "Sign in to post" affordance is fine — the banned thing is the YouTube box).
3. **Chat area background = black**, light text, readable.
4. **Kick-first.** Landing live content comes from **Kick** (News / IRL / Games) and
   **real API-Football** (Sports). YouTube curated is no longer a landing source.
5. **Cards use a placeholder tile** (deterministic gradient + channel initial + LIVE
   badge + REAL viewer count) because **Kick exposes no per-stream thumbnail**. We
   NEVER fabricate a screenshot.
6. **Search** resolves a favourite Kick stream: exact channel-slug lookup + filter of
   the live Kick browse list.
7. **Desktop landing** = 3-column grid, category sections on scroll, "Show more"
   expands a section to 9 (3×3), plus a hero featured Kick player box.

---

## 1. Honesty invariants (ALL agents — non-negotiable)

- **No fabricated media.** Kick rows have `thumbnailUrl === ''`. Render the
  placeholder tile; never invent an image URL.
- **No fabricated numbers.** `viewerCount` is `null` when a source has none → render
  nothing, never a fake `0` (see `web/src/lib/live.js` `optInt`).
- **Empty is allowed and must be shown honestly.** If a Kick bucket has no live
  channels right now, show an honest empty state — do not backfill from another
  provider or from static data.
- **Degraded/stale/floor** ladder rungs keep their existing labels; do not present a
  stale grid as fresh.
- **AI/seed content stays labeled** (existing `ai`/`system`/`trade` chat kinds).

---

## 2. Shared data shapes (the frozen contract)

### 2a. `LiveChannel` (server → web) — one additive change
Existing shape is unchanged (`server/src/aggregator/schema.js`, mirrored by
`web/src/lib/live.js` `normalizeChannel`). **Agent B adds exactly one field:**

```
bucket: 'news' | 'sports' | 'irl' | 'games' | 'other'   // derived, see §3
```

- `category` stays the **source-native** label (Kick `category.name`) — untouched.
- `bucket` is a **UI routing key only**, derived by the deterministic keyword map in
  §3. It never replaces or rewrites `category`.
- Web `normalizeChannel` must pass `bucket` through with default `'other'`
  (**Agent C** owns the web `live.js` edit; Agent B owns the server `schema.js`).

### 2b. Football match (unchanged) — `normalizeMatch` in `web/src/lib/live.js`
Sports section consumes this. No new fields.

### 2c. Chat message (already exists — reuse verbatim)
- Table `chat_messages(room_id, user_id, kind, body, created_at, is_seed, display_name)`,
  `kind ∈ {'chat','system','trade','ai'}`.
- `POST /api/chat` body `{ roomId: uuid, body: string(1..280) }`, behind `auth` +
  `chatLimiter` (`server/src/app.js:243`). Returns the inserted row; broadcasts
  `hub.broadcast(roomId, 'chat', { id, kind:'chat', body, name, ts })`.
- SSE: `GET /api/stream/:roomId` (`server/src/app.js:193`); client hook
  `web/src/hooks/useSSE.js` already opens it.
- Client call already present: `api.chat(roomId, body)` (`web/src/lib/api.js:103`).

---

## 3. Kick category → `bucket` map (Agent B implements, deterministic)

Apply to the **lowercased** source-native `category` (Kick name). First match wins.
This is a fixed table, not a guess per channel:

- **news** — contains any of: `news`, `journalis`, `talkshow`, `politics`, `sporting news`
- **games** — contains any of the gaming signals: `gaming`, `game`, or is a known title
  (`valorant`, `fortnite`, `minecraft`, `gta`, `apex`, `cs2`, `counter-strike`, `league`,
  `rocket league`, `forza`, `ea fc`, `efootball`, `arc raiders`, `call of duty`)
- **sports** — contains any of: `sports`, `football`, `soccer`, `basketball`, `nba`,
  `ufc`, `boxing`, `cricket`, `tennis`, `golf`, `hockey`, `racing`
- **irl** — contains any of: `irl`, `just chatting`, `chatting`, `travel`, `outdoor`,
  `food`, `music`, `art`, `creative`, `asmr`, `talk`
- **other** — everything else (default)

Kick rows only. YouTube/floor rows keep `bucket:'other'` (they are not landing
sources anyway). Unit-test the map on representative Kick category strings.

---

## 4. Landing section → data source (Agent C consumes)

| Section  | Source                                             | Empty policy |
|----------|----------------------------------------------------|--------------|
| Sports   | real API-Football matches (`/api/live?category=football` / existing football feed) | honest empty |
| News     | Kick rows with `bucket==='news'`                   | honest empty |
| IRL      | Kick rows with `bucket==='irl'`                    | honest empty |
| Games    | Kick rows with `bucket==='games'`                  | honest empty |

- Grid: **3 columns** on desktop (`lg:grid-cols-3`), 2 on `sm`, 1 on mobile.
- Each section renders **3 cards** collapsed; **"Show more"** reveals up to **9**
  (3×3). No pagination needed; slice from the fetched list.
- Hero featured box: the top Kick row (highest `viewerCount`) rendered as a large
  `KickVideo` embed + right info panel (avatar-initial, name, category, viewers,
  tags). Use the existing `KickVideo` component.

---

## 5. Agent lanes, files, and acceptance

### Agent A — LiveEdge chat (FRONTEND ONLY)
**Do:**
- New `web/src/components/ChatComposer.jsx`: textarea + Send; calls
  `api.chat(roomId, body)`; if `!user`, show a "Sign in to post" affordance that
  opens the existing auth modal (reuse `useAuthModal`/`openAuth`) — do NOT render a
  dead button. On success, optimistic-append.
- `web/src/components/ChatFeed.jsx`: keep rendering; set the container background to
  **solid black** (`bg-black`) with readable text; append the composer.
- `web/src/pages/WatchRoom.jsx`: **remove the provider-chat iframe path**
  (`ChatColumn`'s `chat.src` YouTube branch and the "Real YouTube live chat" caption).
  Replace the chat column with LiveEdge `ChatFeed`+`ChatComposer` for the room.
  Watch pages need a `roomId` to post into — see §5a.
- `web/src/pages/Room.jsx`: ensure the existing `ChatFeed` gets the composer + is
  backed by `useSSE` events (verify `events` flows in).
**Acceptance:** no YouTube/provider chat iframe anywhere; a signed-in user can post
and see it appear live for others; guests see the sign-in affordance; chat bg black.

**§5a Watch-page chat identity (decision needed from verifier, default given):**
`/watch/:source/:slug` has no room row. Default: watch pages post into a **derived
singleton room** per channel — the verifier will expose/confirm a `GET
/api/rooms/ensure?channel=<source:slug>` that returns (or creates) a lightweight
watch-room id, OR Agents A+C agree watch pages reuse the room if one is bound.
Until confirmed, Agent A wires the composer to `room.id` where a room exists and
leaves a clearly-labeled TODO for the no-room watch case (do NOT invent a roomId).

### Agent B — Kick-first data + bucketing + search (SERVER ONLY)
**Do:**
- `server/src/aggregator/schema.js`: add `bucket` to `makeLiveChannel` (default
  `'other'`) + export a pure `bucketForCategory(category)` implementing §3.
- `server/src/kick/client.js` (or the aggregator mapping): set `bucket` on Kick rows.
- `server/src/routes/live.js`: ensure Kick rows carry `bucket`; keep Kick-first
  ordering; do not surface YouTube curated on the default landing path.
- `server/src/routes/search.js`: add Kick **exact channel-slug lookup** — when `q`
  looks like a slug, call `kick.getChannelBySlug`/`validateChannel` and include the
  live channel if `isLive`; keep the existing contains-filter over the Kick browse
  list. Never fabricate a hit.
- Tests: `bucketForCategory` table test; search slug test; live route bucket test.
**Acceptance:** `/api/live` Kick items include a correct `bucket`; `/api/search?q=<slug>`
resolves a live Kick channel; server suite stays green.

### Agent C — Landing/browse UI redesign (WEB ONLY)
**Do:**
- `web/src/lib/live.js`: pass `bucket` through `normalizeChannel` (default `'other'`).
- New `web/src/components/LiveTile.jsx`: placeholder tile (deterministic gradient
  from `channelSlug` hash + channel initial + LIVE badge + real `viewerCount`; NO
  image when `thumbnailUrl` empty). Reused by grid + rail.
- New `web/src/components/CategorySection.jsx`: header + 3-col grid, 3 collapsed /
  9 on "Show more", honest empty state.
- `web/src/pages/Discover.jsx`: replace the current Live-now rail with the four
  sections (§4): Sports (football), News, IRL, Games (Kick buckets). Add the hero
  featured `KickVideo` box. Keep pins/tailoring behavior where it still applies.
- `web/src/components/SideRail.jsx`: reuse `LiveTile`-style entries if helpful.
- Tests (Vitest, pure): bucket→section grouping, tile deterministic gradient,
  collapse/expand counts (3→9), empty-state.
**Acceptance:** desktop landing shows the 4 sections as 3-col grids with working
"Show more"→9, hero Kick box, placeholder tiles (no fake art), black chat not in
scope here.

---

## 6. File-ownership matrix (avoid collisions)

| File | Owner | Others may… |
|------|-------|-------------|
| `server/src/aggregator/schema.js` | **B** | read only |
| `server/src/routes/live.js`, `search.js`, `kick/client.js` | **B** | read only |
| `web/src/lib/live.js` | **C** | A/B read only |
| `web/src/components/{ChatFeed,ChatComposer}.jsx` | **A** | — |
| `web/src/pages/WatchRoom.jsx`, `Room.jsx` | **A** | C must NOT touch |
| `web/src/pages/Discover.jsx`, `SideRail.jsx`, new `LiveTile/CategorySection` | **C** | — |
| `web/src/lib/api.js` | **A** (chat already present) | C reads only |
| `server/src/app.js` | **nobody** (chat/stream already mounted) | — |

If two agents need the same file, STOP and raise it to the verifier before editing.

---

## 7. Commands (pnpm monorepo, Windows PowerShell — use `;` not `&&`)

```
# install (once per worktree)
pnpm install
# server tests
cd server; npm test          # ~9.5 min, run foreground
# web tests / build / lint
cd web; npx vitest run
cd web; npm run build
cd web; npm run lint
# secret gate (repo root)
node scripts/check-secrets.mjs
```

## 8. Report format each agent returns to the verifier
1. Branch/worktree name + final `git log --oneline -1`.
2. Exact files added/changed/deleted.
3. Commands run + **pass/fail counts** (server suite, vitest, build, lint,
   check-secrets) — paste the tail, not a claim.
4. Any place you hit a §1 honesty edge or a §5/§6 ambiguity, and how you handled it.
5. Anything you did NOT do that the contract expected.
