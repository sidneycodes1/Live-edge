# LIVEEDGE — FULL AUTONOMOUS AUDIT REPORT (v2)

Audit performed against the "LIVEEDGE — FULL AUTONOMOUS AUDIT (v2)" directive. Every
claim below is backed by a command + real output, a `file:line`, or a screenshot. Items
I could not verify are marked **NOT VERIFIED**. No secret is printed anywhere; the real
`PANTA_API_KEY` is referred to as `[REDACTED]`.

---

## 1. Executive summary

**Verdict:** The core judge loop (open Discover → sign in as guest → open a room → back
YES/NO → odds move → balance updates) **works in a real browser today**. Three of the four
boot/trade blockers are fixed and pushed; the fourth (B2) was proven not to be a defect.

**Can a judge complete the whole loop in under two minutes?** **Partly.** Discovery, guest
sign-in and trading pass end-to-end in headless Chromium (8/8 UI steps). But the **claim
button in the UI is broken** (Portfolio never calls the claim build endpoint), there is
**no email/password account path**, **no notifications/transaction history**, and the Room
page throws a **React infinite-render error** (22 console errors) that violates the quality
bar. Market creation works at the API layer but is unverified through the Creator UI.

**Top 5 problems:**
1. **P0** — A real live API key is committed in `REPORT.md:124`; `check-secrets` fails.
2. **P1** — Room page infinite re-render loop (`Maximum update depth exceeded`) — T8.
3. **P1** — UI claims are broken: `Portfolio.claim()` skips `/api/claims/win/build`.
4. **P1** — No email/password identity and no in-app notification/toast wiring — T1/T6.
5. **P2** — No transaction history (`/api/ledger` missing); faucet overwrites balance.

**Readiness score: 5 / 10.** The engine and money math are sound and testable (74/74 unit
tests, 15/15 attacks, 17/17 HTTP E2E), but the product surface is missing identity depth,
feedback, history, and has one UI-breaking render bug and a committed secret. Credible as a
"watch odds move and place a play-money bet" demo; not yet a complete, polished MVP.

---

## 2. Environment and versions

| Item | Value | Evidence |
|---|---|---|
| OS | Windows 23H2, PowerShell | user_info |
| Node | v24.11.1 | `node -v` |
| pnpm | 9.12.3 | `pnpm -v` |
| Branch | `main` (remote `github.com/sidneycodes1/Live-edge.git`) | `git rev-parse --abbrev-ref HEAD` |
| Test runner | `node:test` (`node --test test/**/*.test.js`) | `server/package.json:9` |
| DB (local/test) | PGlite 0.2.17 (in-memory for tests, on-disk `server/.data/pglite` for dev) | `server/src/db/index.js:41-47` |
| Playwright | 1.63.0 (added dev-only for A4) | `audit-logs/a4-playwright-install.txt` |

Note: `pnpm install --frozen-lockfile` was not re-run from scratch here (node_modules already
present from the prior session); the fresh-clone check is covered in §14 and §16.

---

## 3. Blocker fixes (B1–B4)

### B1 — `.env` `PANTA_MODE` not applied → boot crash. **FIXED.** Commit `5287008`.
- **Root cause:** `server/src/server.js` resolved the env path with
  `__filename.replace('src/server.js', '../.env')`. On Windows `fileURLToPath` returns
  **backslashes**, so the forward-slash pattern never matched; the code fell through to
  reading `server.js`'s **own source** as a `.env`. Because **Windows env vars are
  case-insensitive**, the source line `port = next;` (in the EADDRINUSE handler) was parsed
  as `PORT=next;` → `Number("next;")=NaN` → Zod `PORT` validation crashed boot before any
  mode was applied. (This is why the earlier symptom was "effectiveMode=sim" / crash.)
- **Fix:** new `server/src/config/dotenv.js` with a strict `^KEY=value` parser (rejects
  `port = next;` because of the space before `=`), cwd/OS-independent candidate resolution
  (repo-root `.env` first, then `server/.env`), and existing-`process.env` precedence.
  `server.js` now calls `loadDotEnv()` before `loadEnv()` and logs the loaded path + raw
  `PANTA_MODE` (never the key).
- **Regression test:** `server/test/dotenv.test.js` (4 cases, incl. the `port = next;`
  rejection).
- **Before/after evidence:**
  - Before: boot log `Error: getaddrinfo`/`PORT` NaN crash (A0/A1).
  - After (real `.env`): `dotenv loaded=true path=C:\...\Live edge\.env applied=15` and
    `effectiveMode=hybrid requestedMode=hybrid` (see §16 command output).

### B2 — `GET /api/config` 404. **NOT A DEFECT (proven).**
- `server/src/routes/config.js:5` defines `r.get('/')`, mounted at `app.use('/api/config',
  configRouter(env))` (`server/src/app.js:59`). A live in-process call returns
  **200** with `{mode, requestedMode, warnings, features, sim}` (see `audit-logs/a4-e2e.txt`:
  `PASS | GET /api/config is 200 ... mode=sim features={"liveReads":false,"previewBuy":false}`).
- The historical 404 matches the **old** route shape `r.get('/config')` under an
  `/api/config` mount (→ `/api/config/config`), which `PHASE_1.md:11` records as already
  fixed. I did **not** fabricate a change. No commit.

### B3 — Newly created market immediately `closed`. **FIXED.** Commit `a4f2b9e`.
- **Root cause:** creation logic is correct — `simClient.registerMarket` sets
  `end = now + endInMinutes*60000` and status defaults open (`server/src/panta/simClient.js:85-92`).
  The defect was **ordering + selection**: `GET /api/rooms/:id` ordered markets
  `order by status asc` (alphabetically `closed` < `open` < `resolved`), and
  `web/src/pages/Room.jsx:21` uses `markets[0]` as the active market. The on-disk dev DB
  (`server/.data/pglite`, gitignored) shipped with seed markets already past `end_time`, so a
  **closed** market was surfaced as active → `closed` badge + `POST /orders/quote` 400.
- **Fix:** order by explicit status rank `(open=0, closed=1, resolved=2), created_at desc`
  in both the room hero (`rooms.js:20`) and detail list (`rooms.js:60`).
- **Regression test:** `server/test/market-lifecycle.test.js` (3 cases: fresh 10-min market
  is open + tradeable; closes only after `end_time`; room surfaces open ahead of closed).
- **After evidence:** browser run on a seeded room → `PASS | Room shows the OPEN market (B3)`
  (`audit-logs/a4-browser.txt`, `audit/screenshots/02-room-desktop.png`).

### B4 — Duplicate "closed" status text. **FIXED.** Commit `e934bd3`.
- **Root cause:** `web/src/components/MarketPanel.jsx` rendered the status badge
  `{market.status}` **and** `{fmtTimeLeft(market.end_time)}`; `fmtTimeLeft` returns the
  literal string `'closed'` once the end time passes (`web/src/lib/format.js`), so a closed
  market showed "closed" twice.
- **Fix:** render the time-left span only when `market.status === 'open'`
  (`MarketPanel.jsx:10`).
- **After evidence:** browser run → `PASS | Room open market shows no stray "closed" (B4)`
  (`closed-count=0`); open market shows a single `open` badge + `56m 55s` countdown in
  `audit/screenshots/02-room-desktop.png`.

---

## 4. Findings table

| ID | Sev | Area | File:line | What is wrong | Evidence | Recommended fix | Effort (h) |
|---|---|---|---|---|---|---|---|
| F-001 | P0 | Secrets | `REPORT.md:124` | Real live `PANTA_API_KEY` (`pk_live_[REDACTED]`) committed; `check-secrets` fails (exit 1) | `node scripts/check-secrets.mjs` → `found in REPORT.md` | Rotate key immediately; redact doc; add pre-commit hook | 1 |
| F-002 | P1 | Frontend/perf | `web/src/pages/Room.jsx:23-28` | Infinite re-render: `useEffect([events, activeMarket])` calls `setActiveMarket` producing a new object every run | 22× "Maximum update depth exceeded" in `audit-logs/a4-browser.txt` | Guard: only set when price actually changes; drop `activeMarket` from deps or use functional compare | 2 |
| F-003 | P1 | Claims/UI | `web/src/pages/Portfolio.jsx:13-23,24-33` | `claim()`/`claimFees()` sign a client `nonce: Date.now()` and never call `/api/claims/win/build`; server requires build nonce → `INVALID_SIGNATURE` | `simClient.submitClaim:274-275`; HTTP E2E had to call `/win/build` first | Call build endpoint, sign returned `canonicalPayload` | 3 |
| F-004 | P1 | Auth | `server/src/routes/auth.js` (only `/nonce`,`/verify`) | No email/password register/login/me/logout; guest-wallet only | Route map §6; app.js mounts | Implement layer in §13 | 12 |
| F-005 | P1 | Feedback | `web/src/App.jsx:16,31` | `setToast` created but never passed to children → no toast on sign-in/create/faucet; no notification center/history | `App.jsx` has no prop wiring; no `/api/notifications` | Wire toast + add notifications table/route | 8 |
| F-006 | P2 | Wallet | missing `routes/ledger.js`; `app.js` | No transaction history endpoint (T2 requires visible ledger) | Route audit §6 | Add `GET /api/ledger` from `trades` | 4 |
| F-007 | P2 | Money | `server/src/routes/faucet.js:19` | `set sim_usdc=100` **overwrites** (can lower a balance >100); UI label "+$100" implies additive | read of faucet.js | `sim_usdc = sim_usdc + 100` (cap as needed) | 1 |
| F-008 | P2 | Security | `server/src/app.js` (no `app.set('trust proxy')`) | Behind Render/proxy all requests share one IP bucket → limits ineffective / easy global block; auth limiter 10/min shared | `rateLimit.js` uses default IP key | `app.set('trust proxy', 1)` and validate | 1 |
| F-009 | P2 | Money | `simClient` (`Number(...)`, `round6`) | Money computed as JS **floats**, not integer micro-units; no double-entry invariant test | A7 attacks pass but no ledger-sum assertion | Store micro-units (int); add balance+house==minted test | 6 |
| F-010 | P2 | Markets | `simClient.registerMarket:89-93` | Creation fee is quoted (`fee=1`) but **never deducted** from balance in sim | E2E: 100→90 after $10 buy (no −1 fee) | Deduct fee at register; ledger entry | 2 |
| F-011 | P3 | Routes | `server/src/routes/health.js:5` + `app.js:56` | Health is at root `/health` (returns `"ok"`), not `/api/health` as the directive's route map states; no status/uptime | E2E: `/api/health=404`, `/health=200` | Either add `/api/health` alias or correct the doc | 0.5 |
| F-012 | P2 | Deps | express 4.19.2, react-router, vite | `pnpm audit`: 2 critical (vitest, dev-only), 8 high (body-parser, path-to-regexp ×3, @remix-run/router, vite, postcss ×2) | `pnpm audit` exit 1 | Bump express→4.21+, react-router, vite | 2 |
| F-013 | P3 | Feedback (B5) | sign-in / market-create | Sign-in and market creation give no visible confirmation (no toast) | F-005 root; screenshots | covered by F-005 | — |
| F-014 | P3 | Stream (B6) | `web/src/components/VideoStage.jsx`; `web/public/` (empty) | "Stream placeholder / Demo video would play here"; no `demo-stream.mp4`; seed `video_url` is `example.com` (non-mp4) | `audit/screenshots/02-room-desktop.png` | Bundle a short loop mp4 or a labelled animated frame | 3 |
| F-015 | P3 | Copy (B7) | `Room.jsx:41`; `tailwind.config.js` (`live:#FFB800`); `web/index.html` | "1 viewers" (no pluralization); LIVE dot is amber; favicon 404 (no link + empty `public/`) | screenshot 02 | `viewers>1?'viewers':'viewer'`; red/green live dot; add favicon | 1 |
| F-016 | P3 | Client security | `web/src/lib/wallet.js:5,20` | Guest **private key** stored in `localStorage` (`liveedge_guest_secret`) | read | Acceptable for play money; document; consider sessionStorage | 1 |
| F-017 | P3 | Dev/DB | `.env` `DATABASE_URL` | Committed `.env` DB host is a placeholder (`ENOTFOUND host`); `node src/server.js` with real `.env` cannot boot without network | `audit-logs/a4-server-boot.txt` | `.env.example` guidance; auto-fallback to PGlite if DB unreachable | 2 |
| F-018 | P3 | SSE | `server/src/routes/stream.js:8-13` | No per-IP connection cap (resource exhaustion); `ACAO:*` is fine here (EventSource sends no credentials) | read; `sse.js` cleanup verified (no leak) | Cap connections/IP | 2 |
| F-019 | P3 | Config | `server/src/config/env.js:8` | Hardcoded dev JWT fallback secret (prod guard exists at `env.js:23`) | read | Fail loudly if unset outside dev | 0.5 |
| F-020 | P3 | Claims | `simClient.submitClaim:267` vs `:289` | Replaying a completed claim returns 400 "Already claimed" (not idempotent-200 like orders); money-safe but inconsistent | E2E replay result | Return idempotent 200 on replay | 1 |

---

## 5. Target coverage matrix (T1–T8)

| Target | Status | Note |
|---|---|---|
| T1 Landing explains play money | DONE | ModeBadge "Play money · simulated settlement" (screenshot 02) |
| T1 Create account (email+password) | **MISSING** | Only guest wallet (F-004) |
| T1 Continue as guest | DONE | Verified in browser (03-signed-in.png) |
| T1 Signup/guest notification | **BROKEN** | No toast wired (F-005) |
| T1 Guest→account upgrade | **MISSING** | No account layer to upgrade to |
| T1 Sessions persist / sign out | PARTIAL | Token in sessionStorage; sign-out works; refresh keeps guest (localStorage key) |
| T2 Balance in header, live | **MISSING** | Header shows address only (TopNav/WalletButton); balance only on Portfolio |
| T2 Faucet cooldown + feedback | PARTIAL | Cooldown enforced (429+retryAfter); in-page msg only; **overwrite bug** (F-007) |
| T2 Ledger / transaction history | **MISSING** | No `/api/ledger` (F-006) |
| T3 Discover lists rooms/odds | DONE | 2 seeded rooms render (screenshot 01) |
| T3 Room page (stream/market/odds/trade/feed/viewers) | PARTIAL | All present; stream is placeholder (F-014); "1 viewers" (F-015) |
| T3 Odds live over SSE | DONE (code) | Hub broadcast + reconnect logic present; live SSE movement not asserted in this run (NOT VERIFIED in-browser) |
| T4 Trade sheet (side/amount/impact/confirm/success) | DONE | Verified in browser; balance updated 100→90 |
| T4 Specific errors | DONE | Insufficient funds / closed / validation codes present (A7) |
| T4 Closed markets disable trading | PARTIAL | Server 400s; UI badge fixed (B4) but no explicit disabled state |
| T5 Any signed-in user creates market | PARTIAL (API) | Works via API (E2E); Creator UI not exercised (NOT VERIFIED) |
| T5 Creation fee from balance | **BROKEN** | Fee quoted, not deducted (F-010) |
| T5 Fresh market open immediately | DONE (fixed) | B3 fix + regression test |
| T5 Creator fee share in Portfolio | PARTIAL | Shown; graduation-gated |
| T5 Creator-only resolve | DONE | 403 for non-creator (A7/E2E) |
| T6 Portfolio (positions/P&L/created/history) | PARTIAL | No transaction history (F-006); raw float precision shown |
| T6 Claims pay once, idempotent, notification | **BROKEN (UI)** | Backend pays once (E2E); UI claim broken (F-003); no notification |
| T7 Panta honesty per mode | PARTIAL | ModeBadge + config features present; hybrid "Live quote" badge NOT VERIFIED in UI |
| T8 Every action has feedback | **PARTIAL/BROKEN** | Trade has TxStatus; sign-in/create/faucet weak (F-005/F-013) |
| T8 No console errors on clean run | **BROKEN** | Room infinite-render (F-002) |
| T8 Mobile + desktop | DONE | 390px + 1440px screenshots render |

---

## 6. Route audit table

Backend (called via `scripts/e2e-audit.mjs` / `audit-api.mjs`; auth where required):

| Route | Expected | Actual | Verdict |
|---|---|---|---|
| `GET /health` | 200 | 200 `"ok"` | OK (root, not `/api/health`) |
| `GET /ready` | 200 | 200 `{db:true}` | OK |
| `GET /api/health` | 200 (per directive) | **404** | Doc mismatch (F-011) |
| `GET /api/config` | 200 mode+features | 200 | OK (B2 not a defect) |
| `GET /api/rooms` | list | 200 array | OK |
| `GET /api/rooms/:id` | detail+markets | 200 | OK (ordering fixed B3) |
| `GET /api/markets/catalog` | list | 200 `{source,items}` | OK (sim→unavailable) |
| `GET /api/markets/:id` | detail | 200 | OK |
| `GET /api/stream/:roomId` | SSE | 200 text/event-stream | OK; cleanup verified |
| `POST /api/auth/nonce` | 200 | 200 | OK |
| `POST /api/auth/verify` | 200 JWT | 200 | OK |
| `POST /api/auth/register|login|logout`, `GET /api/auth/me` | expected | **MISSING** | F-004 |
| `POST /api/rooms` | 201 (auth) | 201 | OK |
| `POST /api/markets/quote|build|register` | create flow | 200/201 | OK (fee not deducted F-010) |
| `POST /api/markets/:id/resolve` | creator only | 200/403 | OK |
| `POST /api/orders/quote|build|submit` | trade flow | 200 | OK, idempotent |
| `POST /api/claims/win/build` + `/win` | claim once | 200; replay 400 | OK backend; UI broken F-003 |
| `GET /api/portfolio` | balance/positions/created | 200 | OK; no history F-006 |
| `POST /api/faucet` | top-up | 200/429 | Overwrite bug F-007 |
| `GET /api/notifications`, `GET /api/ledger` | expected | **MISSING** | F-005/F-006 |

Frontend routes (`web/src/App.jsx:22-28`): `/` Discover, `/room/:id`, `/creator` &
`/creator/:roomId`, `/portfolio`, `/about`, `*` NotFound. All render (screenshots). No dead
links found in TopNav/BottomTabs.

---

## 7. E2E results

**HTTP-level full loop** — `scripts/e2e-audit.mjs` (real app, real ed25519 signing, PGlite
in-memory, sim). Output `audit-logs/a4-e2e.txt`: **17/17 PASS, exit 0.** Steps: health,
config, rooms, guest sign-in, welcome balance 100, create room, create market
(quote→build→sign→register), **B3 fresh market open**, room surfaces open first, quote,
buy YES $10, second guest buy NO $20 (**odds 0.5→0.398**), resolve as creator, non-creator
403, claim pays exactly once (balance stable on replay), portfolio.

**Real browser (Playwright, headless Chromium 1243)** — `scripts/e2e-browser.mjs` against
`vite dev` :5173 + API :4000. Output `audit-logs/a4-browser.txt`: **8/8 UI PASS, exit 0.**

| Step | Result | Screenshot |
|---|---|---|
| Discover renders "Live Rooms" | PASS | `01-discover-desktop.png` |
| Discover shows market cards | PASS (2) | `01` |
| Room shows OPEN market (B3) | PASS | `02-room-desktop.png` |
| No stray "closed" (B4) | PASS (count 0) | `02` |
| Guest sign-in via demo wallet | PASS | `03-signed-in.png` |
| Trade sheet submit YES $10 | PASS (balance→90) | `04-tradesheet.png`, `05-trade-after.png` |
| Portfolio numeric balance | PASS ($90.00) | `06-portfolio-desktop.png` |
| Mobile 390px discover + room | PASS | `07-discover-mobile.png`, `08-room-mobile.png` |
| About page | captured | `09-about.png` |

**Console errors captured: 22 app errors** — all `Maximum update depth exceeded` at
`Room.jsx` (F-002). Failed/4xx network: **0**.

---

## 8. UX findings by screen

- **Discover (`01`):** Clear; "Live Rooms" + cards with odds/status. Good empty state
  (`EmptyState`). No "what is this / play money" line on first paint beyond the header badge.
- **Room (`02`):** Market panel + odds bar + YES/NO are clear and B3/B4 fixed. Problems:
  amber "LIVE" dot (F-015), "1 viewers" (F-015), stream placeholder (F-014), and the page
  spams the console (F-002). No balance in header (T2).
- **Trade sheet (`04`):** Good — side toggle, amount presets, live quote line, `TxStatus`
  feedback. Strongest screen.
- **Portfolio (`06`):** Balance + positions render; but position shows raw `17.990385`
  (no rounding), no transaction history, and the Claim action is broken (F-003).
- **Sign-in / create:** No confirmation toast (F-005/F-013).
- **Mobile (390):** Renders without layout breakage at the sampled screens.

---

## 9. Test suite truth table

Command: `node --test` in `server/`. Three complete runs
(`audit-logs/a3-verify-run1.txt`, `a3-verify-run3.txt`, `a3-verify-run4.txt`) each:
**tests 74 | pass 74 | fail 0 | skipped 0 | cancelled 0.** (A second run was truncated by
shell reuse; re-run as run4.) Lint `pnpm lint` exit 0 (2 pre-existing warnings in
`adapter.test.js:133,139` — unused `c` — left untouched).

| File | ~tests | Quality note |
|---|---|---|
| `adapter.test.js` | 19 | Real sim/hybrid adapter behavior; 2 unused-var warnings |
| `orders.test.js` | 11 | Real quote/build/submit incl. **concurrency** (parallel buys, dup signature) |
| `ledger.test.js` | 9 | Balance/position/trade assertions |
| `claims.test.js` | 8 | Build+submit, once-only |
| `lmsr.test.js` | 5 | Price sum/monotonic/bounds |
| `signature-fixtures.test.js` | 6 | client===server===hardcoded canonical strings |
| `auth.test.js` | 4 | nonce/verify, single-use |
| `validation.test.js` | 2 | chat length, no stack leak in prod |
| `sse.test.js` | 1 | broadcast + disconnect |
| `dotenv.test.js` (new) | 4 | B1 parser + `port = next;` rejection + precedence |
| `market-lifecycle.test.js` (new) | 3 | B3 open/tradeable/ordering |

**Known gap (stated honestly):** the PGlite `tx()` mutex (`server/src/db/index.js:68-104`,
`txQueue`) serializes writes in **app code**, so concurrency safety against a **real Postgres
pool** (separate clients) is **NOT VERIFIED**. No live Postgres/Docker was reachable in this
sandbox (the `.env` DB host is a placeholder — F-017), so double-spend/double-claim under
real connection concurrency could not be exercised. Orders/claims tests simulate parallel
submits through the mutex only.

---

## 10. Money / logic attack results

`audit-logs/a7-attacks.txt` — **15 checks, 15 PASS, 0 FAIL** (in-process app, sim):
LMSR spend≈cost self-consistent; negative/NaN/huge/invalid-side rejected (400); huge amount
→ INSUFFICIENT_FUNDS (overdraft guard); replayed signature idempotent (no double spend);
non-creator resolve → 403; creator resolve → 200; cannot trade resolved market; nonce
single-use (2nd → 401); garbage signature rejected; hybrid `/api/config` reports
`mode=hybrid liveReads=true`; catalog survives dead Panta (fallback); `quoteCreate` falls
back to sim with `liveError` when Panta dead.

**Gaps found despite passing:** money is float-based (F-009); creation fee not deducted
(F-010); faucet overwrites (F-007); no ledger-sum invariant test.

---

## 11. Panta integration findings

- Mode selection (`server/src/panta/index.js`) + `hybrid.js` fall back to sim on live error
  (verified: catalog `source=unavailable`, `quoteCreate` `liveError=fetch failed` — §10).
- `GET https://live-api.panta.market/api/v1` returned **HTTP 404** from this environment
  (reachable host, no handler at base) — so the guessed endpoint paths in `liveClient.js`
  could **not** be confirmed against a live response here.
- **NOT VERIFIED:** I did **not** exercise real authenticated live reads / `quoteCreate`
  against Panta with the key (would require trusting the committed key + reachable documented
  endpoints), and I did **not** fetch/verify the official Panta docs URLs. Per directive, no
  real transaction was built/signed/submitted. **Needs human:** confirm `liveClient.js`
  endpoint paths against current official Panta docs and run one authenticated read.

---

## 12. Security findings (severity-ranked)

1. **P0 F-001** — committed live key (`REPORT.md:124`); `check-secrets` exit 1. Rotate + redact now.
2. **P2 F-008** — no `trust proxy` → rate limits keyed to proxy IP (ineffective / global-block risk).
3. **P2 F-012** — 2 critical + 8 high transitive deps (express/router/vite/postcss pinned old).
4. **P2 F-009** — float money, no double-entry invariant test.
5. **P3 F-016** — guest private key in `localStorage` (play money only).
6. **P3 F-018** — SSE has no per-IP connection cap (cleanup/listener removal verified — no leak).
7. **P3 F-019** — hardcoded dev JWT fallback secret (prod throws if left dev-only — `env.js:23`).

Verified good: all DB queries parameterized (no string interpolation of user input —
SQLi-clean across reviewed routes); JWT expiry 1h (`auth.js:82`); nonce single-use + 5-min
TTL (`auth.js:32,66`); signature verification via ed25519 over canonical JSON
(`signature.js`, fixtures test); helmet enabled (`app.js:43`); creator-only resolve
(`markets.js:156`); error handler does not leak stacks in prod (`validation.test.js` pass).
CSP/HSTS on localhost and SSE `ACAO:*` are present but not exploitable given EventSource
sends no credentials; still recommend tightening CSP `upgrade-insecure-requests` off for
plain-http dev.

---

## 13. Auth / notification design proposal (A6 — design only, not built)

**Identity model (keep guest, add email+password on top):**
- New columns on `users`: `email citext unique`, `password_hash text`, `kind text
  check(kind in ('guest','email'))`, `upgraded_at timestamptz`. Guest keeps `wallet`.
- Password hashing: built-in **`node:crypto.scrypt`** (no new dependency), per-user random
  salt, stored as `scrypt$N$r$p$saltB64$hashB64`. Verify with `crypto.timingSafeEqual`.
- Endpoints: `POST /api/auth/register {email,password}`, `POST /api/auth/login
  {email,password}` → JWT, `GET /api/auth/me`, `POST /api/auth/logout` (client drops token),
  `POST /api/auth/upgrade` (guest signs a challenge, attaches email+password, **keeps**
  `user.id` → balance/positions preserved).
- Sessions: keep stateless JWT (`{id, wallet}`) with `expiresIn`; add refresh only if needed.
- Guest private key: move from `localStorage` to `sessionStorage` OR keep but document
  play-money scope.

**Notification model (in-app, zero-budget, no outbound email):**
- Table `notifications(id, user_id, kind, body, read_at, created_at)` written on: welcome
  bonus, faucet, trade fill, market created, market resolved, payout available, claim done.
- `GET /api/notifications?unread=`, `POST /api/notifications/read`.
- Wire the existing (currently dead) `Toast` in `App.jsx` via context; add a bell with
  history. Real email is impossible under zero-budget → flag any email-only assumption.

---

## 14. Deployment / submission checklist (A11)

| Item | Status | Evidence / note |
|---|---|---|
| Free deploy (Render + Neon) | PARTIAL | `render.yaml` present; needs real `DATABASE_URL` (current `.env` host is placeholder F-017) |
| Build command | PASS | `pnpm -r build`; `web/dist` builds |
| `pnpm install && pnpm dev` with **no `.env`** | PASS (by design) | Falls back to sim + PGlite; §16 fresh-boot probe shows `dotenv=not-found ... sim` |
| Boots in <2 min from clean clone | NOT VERIFIED | Not re-cloned in this pass; deps already installed |
| `/api/config` 200, `/api/rooms` 200 (no env) | PASS | E2E (sim) both 200 |
| Real `.env` → `effectiveMode=hybrid` | PASS | §16 output |
| CORS/CSP origin for deployed frontend | PARTIAL | `CORS_ORIGIN` default localhost; set per env |
| SSE behind host | RISK | Long-lived SSE + no `trust proxy` (F-008); verify host buffering |
| Migrations | PASS | `server/src/db/migrate.js` runs on boot |
| README / HOW_PANTA_IS_USED accuracy | PARTIAL | `REPORT.md` still shows a live key (F-001) |
| Demo video needs (60–90s) | MISSING pieces | real stream visual (F-014), working UI claim (F-003), notifications (F-005), header balance (T2) |

---

## 15. Proposed fix phases (A12)

| Phase | Goal | Closes | Effort (h) | Risk | Verify by |
|---|---|---|---|---|---|
| **P1 Stop-the-bleed** | Judge's first 2 min are clean | F-001, F-002, F-003, F-005(toast), F-007 | ~10 | Low | re-run browser E2E: 0 console errors; claim works; check-secrets passes |
| **P2 Identity & feedback** | Email/password + notifications + history | F-004, F-005, F-006 | ~20 | Med | auth + notifications tests; UI walkthrough |
| **P3 Money hardening** | Integer micro-units, fee deduct, ledger invariant, real-Postgres concurrency | F-009, F-010, §9 gap | ~16 | High | double-spend/claim under real pool; balance+house==minted |
| **P4 Panta honesty** | Verify live endpoints, hybrid badge | §11 NOT VERIFIED | ~8 | Med | one authenticated live read; doc URLs cited |
| **P5 Polish / ship** | Stream visual, copy, deps, favicon, mobile pass | F-012,F-014,F-015,F-016,F-018,F-019,F-020 | ~14 | Low | `pnpm audit`; final E2E; deploy smoke |

---

## 16. Blocked / NOT VERIFIED / needs human

- **Real-Postgres concurrency** (double-spend/claim under pool): **NOT VERIFIED** — no
  reachable DB in sandbox; `.env` host is a placeholder.
- **Live Panta authenticated reads / doc URL comparison** (§11): **NOT VERIFIED**.
- **Fresh-clone <2min boot:** **NOT VERIFIED** (deps pre-installed; not re-cloned).
- **In-browser SSE odds movement + reconnect:** **NOT VERIFIED** in this run (HTTP layer +
  code reviewed; browser run did not assert a live SSE tick).
- **Creator-market flow through the UI** (Creator.jsx): **NOT VERIFIED** in browser (proven
  at API layer only).
- **Committed `.env` DB host** `ENOTFOUND host` (needs human: supply a real Neon URL or
  document PGlite-only local dev).

Fresh-boot probe (no `.env`), representative of the fallback path:
```
dotenv=not-found path=<repo>\.env applied=0 rawPANTA_MODE=(unset) → sim
```
With the real `.env` present:
```
dotenv loaded=true path=C:\Users\USER\Documents\MY CODES\Live edge\.env applied=15
effectiveMode=hybrid requestedMode=hybrid
```

---

## 17. Assumptions made

1. B2's historical 404 was from the pre-fix `r.get('/config')` mount; current code is
   correct, so I made no change (proven by a live 200).
2. For A4 I booted the app in-process (PGlite/sim) because the committed `.env` DB host is
   unreachable in this sandbox; this exercises the same routes/middleware as `pnpm dev`.
3. "Notification" is interpreted as in-app (toast + bell) since outbound email is impossible
   under the zero-budget rule.
4. Playwright was added as a dev-only root dependency (permitted by §2) and is never imported
   by runtime code.
5. The truncated second test run was replaced by a fourth complete run for the 3× green claim.

---

## 18. Integrity statement

- I **deleted, skipped, weakened, or rewrote no existing test.** The only test edits in this
  pass were to my **own new** `scripts/e2e-audit.mjs` assertions (health path +
  claim-replay expectation) to match the app's real, correct behavior — not any file under
  `server/test/`.
- I **relaxed no lint, secret-scan, or CI check.** Lint passes at exit 0 with only the two
  pre-existing warnings; `check-secrets` was **not** modified (it correctly still fails on
  F-001, which I documented rather than silenced).
- I **invented no APIs**: Playwright 1.63.0, PGlite 0.2.17, express 4.19.2, node:test, and
  `crypto.scrypt` (proposed only) were checked against installed versions.
- I **printed/logged/committed no secret**; the `PANTA_API_KEY` is `[REDACTED]` throughout;
  `.env` was never modified or committed (confirmed untracked).
- **Unsure / flagged:** the exact live Panta endpoint paths in `liveClient.js`, and whether
  the committed `.env` `DATABASE_URL` is intended to be a real Neon URL (currently a
  placeholder host).
