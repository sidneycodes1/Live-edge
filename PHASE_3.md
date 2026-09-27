# Phased Prompt 3 — End-to-End Trade Flow Verification

Send this to the AI agent AFTER Phase 2 is confirmed complete.

---

## Context

Phase 2 is complete. All bugs fixed. UX feedback added. The platform has:
- PANTA_MODE=hybrid with valid PANTA_API_KEY
- /api/config returning 200 with mode info
- Markets staying open after creation
- Guest sign-in with visible feedback
- Toast notifications on all actions

---

## Task: Verify the full trade flow end-to-end

### Step 1: Start the server

Run the server with `PANTA_MODE=hybrid` and verify the startup log shows `effectiveMode=hybrid requested=hybrid`.

### Step 2: Sign in as guest

Verify the sign-in creates a guest wallet and shows the feedback toast: "Signed in as demo wallet (play money) — you've been given $100 to trade with."

### Step 3: Create a market

Use the Creator Panel to create a market with 10-minute duration. Verify:
- The market shows status "open" (not "closed")
- GET /api/markets/{id} returns `status: 'open'`
- `/api/markets/quote` returns a valid quote with `quoteId`
- `/api/markets/build` returns a build response with `signPayload`

### Step 4: Buy YES

- Call `/api/orders/quote` with `{ marketId, side: 'yes', amount: 5 }`
- Verify response has `orderId`, `price`, `shares`, `fee`
- Call `/api/orders/build` with `{ orderId }`
- Verify response has `signPayload`
- Call `/api/orders/submit` with `{ orderId, signature }`
- Verify the trade completes

### Step 5: Buy NO

Repeat the above with `side: 'no'` to verify the opposing side works.

### Step 6: Verify Panta live integration

Since PANTA_MODE=hybrid, some operations should hit the real Panta API:
- `GET /markets/` should return real Panta markets (if `listMarkets` hits live)
- `POST /markets/create/quote/` should return real Panta `{createId, expectedEventPda, ...}` (if the market source is 'panta')
- `POST /primaryorderquote/` should return real Panta `{quoteId, avgPrice, feeUsdc, ...}` (if the market source is 'panta')

### Step 7: Verify sim mode still works

With PANTA_MODE=sim, all operations should use simClient and not hit the Panta API.

---

## Deliverable

Take screenshots of the full flow working:
1. Sign-in screen showing guest wallet feedback
2. Market catalog showing "open" markets
3. Market detail showing YES/NO odds
4. Order confirmation toast
5. Portfolio showing position

Report exact HTTP response codes and JSON for each step.