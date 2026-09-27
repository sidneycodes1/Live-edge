# Phased Prompt 2 — UX Feedback & Copy

Send this to the AI agent AFTER Phase 1 is confirmed fixed.

---

## Context

Phase 1 is complete. PANTA_MODE=hybrid is loaded. /api/config returns 200. Markets stay open after creation. All tests pass.

---

## Task: Add visible feedback and copy

### 1. Sign-in feedback

When a guest wallet is created and signed in, show a toast notification:
- Message: "Signed in as demo wallet (play money) — you've been given $100 to trade with."
- This appears near the sign-in button or as a toast/alert after sign-in completes.

### 2. Sign-in button explainer

Add a short one-line explainer near the sign-in button:
- Text: "No wallet needed — try instantly with play money"
- This explains why there's no email/password step.

### 3. Faucet claim feedback

After claiming faucet money, show a toast:
- Message: "Received $100 play money — you can now trade"

### 4. Market creation feedback

After creating a market, show a toast:
- Message: "Market created — build a quote to start trading"

### 5. Order flow feedback

After buying YES/NO, show a toast confirming the trade:
- Message: "Order submitted — {side} {amount} on {market}"

---

## Files to modify

- `web/` — Add toast notifications and explanatory copy
- `server/src/routes/auth.js` — Add sign-in success response with wallet info
- `server/src/routes/faucet.js` — Add claim success response with amount
- `server/src/routes/markets.js` — Add creation success response
- `server/src/routes/orders.js` — Add order submit success response

---

## Deliverable

Verify all toasts appear by checking the response JSON includes the feedback messages. Run `node --test test/adapter.test.js` to confirm nothing broke.