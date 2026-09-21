# How Panta is Used in LiveEdge

This document describes which Panta capabilities are real vs simulated in each mode.

## Mode Comparison

| Capability | sim | hybrid | live |
|------------|-----|--------|------|
| Market catalog (listMarkets) | Simulated (local DB) | Real Panta API | Real Panta API |
| Market details (getMarket) | Simulated (local DB) | Real Panta API (fallback to sim) | Real Panta API |
| Market creation quote (quoteCreate) | Simulated (1 USDC fee) | Real Panta API (fallback to sim) | Real Panta API |
| Market creation build (buildCreate) | Simulated (unsigned payload) | Real Panta API (fallback to sim) | Real Panta API |
| Market registration (registerMarket) | Simulated (local DB) | Simulated (local DB) | Real Panta API |
| Buy quote (quoteBuy) | Simulated (LMSR pricing) | Simulated for sim markets, Real Panta for Panta markets (preview only) | Real Panta API |
| Buy build (buildBuy) | Simulated (unsigned payload) | Simulated for sim markets, Real Panta for Panta markets (preview only) | Real Panta API |
| Buy submit (submitBuy) | Simulated (local ledger) | Simulated (local ledger) | Real Panta API |
| Positions lookup (getPositions) | Simulated (local DB) | Real Panta for real wallets, Simulated for guest wallets | Real Panta API |
| Metrics (getMetrics) | Simulated (local DB) | Simulated (local DB) | Real Panta API + local DB |
| Claim build (buildClaim) | Simulated (unsigned payload) | Simulated (unsigned payload) | Real Panta API |
| Claim submit (submitClaim) | Simulated (local ledger) | Simulated (local ledger) | Real Panta API |
| Creator fee claim build (buildCreatorFeeClaim) | Simulated (unsigned payload) | Simulated (unsigned payload) | Real Panta API |
| Creator fee claim submit (submitCreatorFeeClaim) | Simulated (local ledger) | Simulated (local ledger) | Real Panta API |

## Key Assumptions

### Simulator Implementation
- **Pricing**: Uses LMSR (Logarithmic Market Scoring Rule) with parameter B=50
- **Fees**: 2% fee on trades (SIM_FEE_BPS=200), 25% goes to creator (SIM_CREATOR_SHARE_BPS=2500)
- **Graduation**: Markets graduate when volume ≥ 100 USDC (SIM_GRADUATION_VOLUME=100)
- **Resolution**: Manual resolution by streamer (simulator stands in for Panta's oracle)
- **Wallet**: Demo wallet uses browser-generated ed25519 keypairs

### Hybrid Mode Restrictions
- Only free Panta API calls are made (catalog, market data, prices, quotes)
- Paid operations (register, submit, claims) are simulated
- Real Panta markets show "Preview only (broadcast disabled in free mode)"
- Preview-only trading shows real quotes but doesn't broadcast transactions

### Live Mode Requirements
- Requires `PANTA_API_KEY` from Panta
- Requires funded wallet for real transactions
- Requires `SOLANA_RPC_URL` for on-chain operations
- All operations go through real Panta API

## Known Limitations

1. **Creator fee claimability**: Only claimable on graduated markets in simulator (Panta may have different rules)
2. **Market resolution timing**: Simulator allows manual resolution by creator; Panta may have oracle-based resolution
3. **Sources of truth**: Simulator accepts any URL; Panta may have stricter validation
4. **Rate limits**: Hybrid mode honors Panta rate limits; simulator has no limits
5. **Liquidity**: Simulator uses fixed B parameter; Panta may have dynamic liquidity

## API Endpoints Used

From Panta API documentation (https://docs.panta.market/):

- `GET /markets` - List markets (catalog)
- `GET /markets/{id}` - Get market details
- `POST /markets/quote` - Get market creation quote
- `POST /markets/build` - Build market creation transaction
- `POST /orders/quote` - Get buy quote
- `POST /orders/build` - Build buy transaction
- `GET /positions/{wallet}` - Get positions
- `POST /claims/build` - Build claim transaction
- `POST /claims/submit` - Submit claim transaction

Note: Endpoints like `POST /markets/register`, `POST /orders/submit`, and claim endpoints are simulated in hybrid mode.
