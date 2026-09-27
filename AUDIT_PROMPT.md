# Full Audit Prompt — LiveEdge Prediction-Market Platform

**Send this entire prompt to the AI coding agent. It has full context of everything done so far, the current bugs, the architecture, and the plan.**

---

## Project Context

You are auditing and fixing the LiveEdge prediction-market platform at `C:\Users\USER\Documents\MY CODES\Live edge`. The project has a server (`server/`) and web frontend (`web/`). Everything has been built from scratch. Tests pass, smoke tests pass, Panta API integration is complete.

**Current git state**: `origin/main`, latest commit `0da5406`. All 54 server tests pass. P6 Panta API audit complete — all liveClient.js paths, bodies, and response fields now match official Panta docs.

---

## CRITICAL BUGS TO FIX FIRST (verify with actual before/after test output)

### Bug 1: PANTA_MODE is `sim` despite `.env` having `PANTA_MODE=hybrid`

**Root cause**: `dotenv` was never installed or imported. `loadEnv(process.env)` receives `process.env` which doesn't have `.env` values because dotenv was never loaded. So `PANTA_MODE` defaults to `'sim'`.

**Fix**: 
- `dotenv` was added to `server/package.json` dependencies and `import 'dotenv/config'` was added to `server/src/app.js`
- Verify by checking that `loadEnv(process.env).effectiveMode` returns `'hybrid'`
- Add a console.log or test assertion confirming `PANTA_MODE` is properly loaded
- Run `node --test test/adapter.test.js` to verify nothing broke

### Bug 2: `/api/config` returns 404

**Root cause**: In `server/src/routes/config.js`, the router has `r.get('/config', ...)` but the route is mounted at `app.use('/api/config', configRouter(env))`. The full path becomes `/api/config/config`, not `/api/config`.

**Fix**: Changed `r.get('/config', ...)` to `r.get('/', ...)` in `server/src/routes/config.js`.
- Verify with: `GET /api/config` should return `{ mode: 'hybrid', requestedMode: 'hybrid', features: { liveReads: true, previewBuy: true }, ... }` with 200 status
- Add a test for this in `test/adapter.test.js` or a new test file

### Bug 3: Market shows as "closed" immediately after creation

**Symptom**: After creating a market via the Creator Panel, the market card shows status "closed" and `/api/orders/quote` returns 400 `MARKET_CLOSED`. The "New market just dropped" toast fires but the market is already closed.

**Investigation needed**:
1. Check how `end_time` is computed at creation. The `markets.js` `quoteCreate` route computes `endTime: body.endTime || new Date(Date.now() + (body.endInMinutes || 10) * 60000).toISOString()`. `simClient.registerMarket` computes `end = new Date(Date.now() + (q.endInMinutes || 10) * 60000).toISOString()`. Both should produce a future time.
2. Check the `app.js` background job: `update markets set status='closed' where status='open' and end_time <= now()` runs every 10 seconds. If `end_time` is stored incorrectly (string vs timestamptz comparison issue), the market could be closed immediately.
3. Check PGlite's handling of `timestamptz` comparisons with ISO string timestamps
4. **Write a test**: Create a market with `endInMinutes: 10` and assert `status === 'open'` immediately after creation

### Bug 4: No feedback on sign-in

**Symptom**: User clicks "Sign in" and nothing visible happens — no toast, no notification, no explanation. First-time users see "guest wallet" and have no idea what happened.

**Fix**: Add a toast/notification when guest wallet is created and signed in:
- Message: "Signed in as demo wallet (play money) — you've been given $100 to trade with."
- Add a one-line explainer near the sign-in button: "No wallet needed — try instantly with play money"

### Bug 5: No feedback on faucet claims and market creation

**Symptom**: After claiming faucet money or creating a market, there's no confirmation toast.

**Fix**: Add toast notifications:
- Faucet claim: "Received $100 play money"
- Market creation: "Market created — you now have a quote to build"

---

## ARCHITECTURE OVERVIEW

### Server (`server/`)

**Entry**: `server/src/server.js` → `createApp({ env })` → `app.listen(PORT)`

**Key modules**:
- `server/src/config/env.js` — `loadEnv()` validates and returns config. `PANTA_MODE` defaults to `'sim'` if not set.
- `server/src/panta/index.js` — `createPanta({ db, env })` creates `simClient`, `hybrid`, or `live` client based on `env.effectiveMode`
- `server/src/panta/liveClient.js` — Direct Panta API client (all write paths match Panta docs)
- `server/src/panta/simClient.js` — Simulation client with in-memory `marketQuotes` and `orderQuotes` Maps
- `server/src/panta/hybrid.js` — Wraps sim + live, normalizes live responses to expected shapes
- `server/src/routes/markets.js` — Market CRUD, quote creation, build, register
- `server/src/routes/orders.js` — Order quote, build, submit
- `server/src/routes/claims.js` — Claim win, creator fee claims
- `server/src/routes/config.js` — `/api/config` endpoint (was broken, now fixed)
- `server/src/lib/signature.js` — `canonicalStringify`, `signCanonical`, `verifyCanonical`
- `server/src/db/migrate.js` — Runs SQL migrations from `server/src/db/migrations/`
- `server/src/db/seed.js` — Seeds initial rooms and markets

**Auth flow**: JWT-based, `POST /api/auth/nonce` → sign message → `POST /api/auth/verify` → JWT token → `Authorization: Bearer <token>` on subsequent requests. Guest wallet created automatically.

**Market lifecycle**: `app.js` runs background job every 10s: `update markets set status='closed' where status='open' and end_time <= now()`. Markets created with `end_time = Date.now() + endInMinutes * 60000`. Default `endInMinutes` is 10.

### Web Frontend (`web/`)

Vite-based React app. Calls `VITE_API_URL` (default `http://localhost:4000`). Key pages: sign-in, market catalog, market detail, creator panel, portfolio, claims.

---

## PANTA API INTEGRATION (already complete)

All `liveClient.js` methods verified against official Panta docs (`https://docs.panta.market/llms.txt`):

| Method | Path | Body | Response |
|--------|------|------|----------|
| `listMarkets` | `GET /markets/` | query params | `{items, nextCursor}` |
| `getMarket` | `GET /markets/{id}/` | — | Full market object |
| `quoteCreate` | `POST /markets/create/quote/` | `{wallet, question, resolutionRule, sourcesOfTruth, category, startTime, endTime, resolutionTime, imageUrl, marketType, title, description, region}` | `{createId, expectedEventPda, paymentUsdc, liquidityInjectionUsdc, platformRevenueUsdc, marketType, expiresAt, blockhashExpiryHintSec}` |
| `buildCreate` | `POST /markets/create/build/` | `{createId, wallet}` | `{createId, transaction(base64), recentBlockhash, lastValidBlockHeight, buildFingerprint, derived}` |
| `quoteBuy` | `POST /primaryorderquote/` | `{wallet, marketId, side, amountUsdc, userId}` | `{quoteId, shares, avgPrice, feeUsdc, expiresAt}` |
| `buildBuy` | `POST /primaryorderbuild/` | `{quoteId, wallet, userId, maxSlippageBps}` | `{orderId, expectedShares, instructions, recentBlockhash, derived, transaction(base64)}` |
| `getPositions` | `GET /positions/?wallet=` | query param | `{wallet, positions:[...]}` |

`hybrid.js` normalizes live responses to match sim shapes so routes and tests work unchanged.

**Real live call verified**: `quoteCreate` returned `{createId, expectedEventPda, paymentUsdc, liquidityInjectionUsdc, platformRevenueUsdc, marketType, expiresAt, blockhashExpiryHintSec}` matching docs exactly.

---

## TEST SUITE

54 server tests across 7 files:
- `test/adapter.test.js` — 18 tests (liveClient paths, bodies, response mappings)
- `test/ledger.test.js` — 8 tests (balance, fees, volume)
- `test/claims.test.js` — 4 tests (creator fee, claim win)
- `test/orders.test.js` — 11 tests (idempotent, parallel, stale, concurrent)
- `test/signature-fixtures.test.js` — 6 tests (canonical strings, signature verification)
- `test/sse.test.js` — 1 test (SSE hub)
- `test/validation.test.js` — 2 tests (chat limits)

`pnpm smoke` passes (sim mode).

---

## WHAT YOU MUST DO

### Phase 1: Fix critical bugs (verify with actual test output)

1. **Fix Bug 1** (dotenv/PANTA_MODE) — verify `loadEnv(process.env).effectiveMode === 'hybrid'`. Add a test.
2. **Fix Bug 2** (/api/config 404) — verify `GET /api/config` returns 200. Add a test.
3. **Fix Bug 3** (market closed immediately) — investigate `end_time` computation and storage. Write a test that creates a market with 10-minute duration and asserts `status === 'open'` immediately after creation. Show actual test output.
4. **Fix Bug 4** (no sign-in feedback) — add toast notification: "Signed in as demo wallet (play money) — you've been given $100 to trade with."
5. **Fix Bug 5** (no feedback on faucet/market creation) — add toast confirmations.

### Phase 2: Verify the trade flow end-to-end

After all bugs are fixed:
1. Start the server with `PANTA_MODE=hybrid` and valid `PANTA_API_KEY`
2. Sign in as guest
3. Create a market via Creator Panel with 10-minute duration
4. Verify the market shows status "open" (not "closed")
5. Buy YES on the market
6. Verify the order flow works: quote → build → submit
7. Take screenshots of the full flow working

### Phase 3: UX polish (if time permits)

- Add "No wallet needed — try instantly with play money" near sign-in button
- Add toast for faucet claims and market creation
- Verify `GET /api/config` returns correct mode info
- Check that `PANTA_MODE=hybrid` is actually loaded at startup (log `process.env.PANTA_MODE`)

---

## TECH NOTES

- **No `dotenv` in package.json** was the original bug. Added `dotenv` dependency and `import 'dotenv/config'` in `app.js`.
- **`/api/config` routing**: `configRouter` creates a `Router()` with `r.get('/', ...)`. Mounted at `app.use('/api/config', configRouter(env))`. Full path is `GET /api/config`.
- **`simClient` uses module-level `Map`s** (`marketQuotes`, `orderQuotes`) that persist across tests within a file. `resetDb` truncates the DB but not these Maps. This is pre-existing behavior.
- **`PANTA_MODE=hybrid` with `PANTA_API_KEY` set** means `hybrid.js` is used. `liveClient.js` methods are called for live operations, `simClient.js` for fallback.
- **`hybrid.js` normalizes live responses** so routes and tests work unchanged. Key mappings: `createId`→`quoteId`, `paymentUsdc`→`fee`, `instructions`→`signPayload`, `avgPrice`→`price`, `feeUsdc`→`fee`.
- **No `signPayload` concept in Panta API**. `buildCreate` returns `transaction` (base64 `VersionedTransaction`). `hybrid.js` wraps this as `signPayload` for backward compatibility.
- **Do NOT attempt to sign or broadcast** — quoteCreate/quoteBuy/buildBuy returning real unsigned transactions is the correct stopping point for hybrid/preview mode.

---

## FILES YOU CAN MODIFY

- `server/src/config/env.js` — verify dotenv loading
- `server/src/app.js` — verify `import 'dotenv/config'` and `loadEnv(process.env)` works
- `server/src/routes/config.js` — verify `r.get('/')` works
- `server/src/routes/markets.js` — fix market lifecycle
- `server/src/routes/orders.js` — fix any order flow issues
- `server/src/routes/auth.js` — add sign-in feedback
- `server/src/routes/faucet.js` — add faucet claim feedback
- `server/src/panta/hybrid.js` — any normalization fixes
- `web/` — add toast notifications and explanatory copy
- `server/test/` — add tests for all fixes
- `server/src/db/migrate.js` — check schema if needed
- `server/src/db/seed.js` — check seed data if needed

---

## DO NOT CHANGE

- **Guest wallet-first auth model** — intentional for hackathon demo
- **`liveClient.js` paths, bodies, and response fields** — already match Panta docs exactly
- **`hybrid.js` response normalization** — already working correctly
- **Sim mode** — must continue to work unchanged
- **`signature.js` canonical stringify** — proven byte-identical with server

---

Report exact test output for all bug fixes. Do not claim anything is fixed without showing actual before/after test output.
