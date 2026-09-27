# Phased Prompt 1 — Critical Bug Fixes (DO THIS FIRST)

Send this to the AI agent. It must fix these bugs with actual test output before proceeding.

---

## Context

You are fixing the LiveEdge prediction-market platform at `C:\Users\USER\Documents\MY CODES\Live edge`. The server is at `server/`, web frontend at `web/`. All 54 server tests currently pass. Panta API integration is complete.

**Current state**: `.env` has `PANTA_MODE=hybrid` and `PANTA_API_KEY=pk_live_...` but `server.js` loads `.env` manually (no `dotenv` dependency). `server.js` reads `.env` using `fs.readFileSync` and injects values into `process.env`. `configRouter` had a routing bug (`r.get('/config')` mounted at `/api/config` making the path `/api/config/config` — fixed to `r.get('/')`).

---

## Task: Fix 3 critical bugs

### Bug 1: PANTA_MODE not loaded at startup

**Verify**: Add a test in `test/adapter.test.js` that calls `loadEnv(process.env)` and asserts `effectiveMode === 'hybrid'` when `process.env.PANTA_MODE === 'hybrid'` and `process.env.PANTA_API_KEY` is set.

**Also**: Add a console.log in `server.js` confirming the raw value: `console.log('PANTA_MODE raw:', process.env.PANTA_MODE)`.

**Test command**: `node --test test/adapter.test.js`

### Bug 2: /api/config returns 404

**Verify**: Add a test that starts the app and does `GET /api/config` and asserts 200 status and `mode === 'hybrid'`.

**Test command**: Add to `test/adapter.test.js` or create a new test file.

### Bug 3: Market shows as "closed" immediately after creation

**Investigate**: Check how `end_time` is computed at market creation. The `markets.js` `quoteCreate` route computes `endTime: body.endTime || new Date(Date.now() + (body.endInMinutes || 10) * 60000).toISOString()`. `simClient.registerMarket` computes `end = new Date(Date.now() + (q.endInMinutes || 10) * 60000).toISOString()`.

**Write a test**: In `test/ledger.test.js` or a new file, create a market with `endInMinutes: 10` and immediately assert `status === 'open'`. The test should fail if the market is closed.

**Check**: The `app.js` background job `update markets set status='closed' where status='open' and end_time <= now()` runs every 10 seconds. Verify `end_time` is stored as a proper `timestamptz` value that is greater than `now()`.

**Test command**: `node --test test/ledger.test.js`

---

## Deliverable

Report exact test output showing all 3 bugs fixed. Do not claim a bug is fixed without showing actual passing test output.
