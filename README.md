# LiveEdge

LiveEdge turns live-stream chat arguments into Panta prediction markets. A streamer drops a question ("Will he beat Malenia first try?"). Viewers back YES or NO in one tap while odds move live next to the video. When the market resolves, winners claim, and the streamer sees volume and creator fees.

## Architecture

```
┌─────────────┐
│   Web App   │ (React + Vite + Tailwind)
└──────┬──────┘
       │ HTTP/SSE
┌──────▼──────┐
│   Express   │ (Node.js)
└──────┬──────┘
       │
┌──────▼──────┐
│ PostgreSQL  │ (Neon or PGlite)
└─────────────┘
       │
┌──────▼──────┐
│   Panta     │ (API or Simulator)
└─────────────┘
```

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm (run `corepack enable` if missing)

### Installation
```bash
pnpm install
```

### Development
```bash
pnpm dev
```
This starts:
- API server on http://localhost:4000
- Web app on http://localhost:5173

### Build
```bash
pnpm build
```

### Test
```bash
pnpm test        # Server tests
pnpm smoke       # End-to-end smoke test
pnpm lint        # Linting
pnpm check:secrets # Check for leaked secrets
```

## Environment Variables

Create `.env` in the root (optional - defaults provided). See `.env.example` for the complete list. Required for production:
- `DATABASE_URL` (PostgreSQL connection string, optional in dev)
- `JWT_SECRET` (32+ character random string)
- `PANTA_API_KEY` (from Panta, required for hybrid/live modes)
SOLANA_RPC_URL=                 # Optional for live mode
SIM_FEE_BPS=200
SIM_CREATOR_SHARE_BPS=2500
SIM_GRADUATION_VOLUME=100
SIM_LIQUIDITY_B=50
```

## Modes

LiveEdge supports three Panta integration modes:

### sim (default)
- Local simulator implementing Panta's API shapes
- Play-money balances (100 sim USDC per user)
- Fully offline, no API key needed
- Labeled "Play money · simulated settlement" in UI

### hybrid
- Real Panta for free calls (catalog, market data, prices, quotes)
- Simulator for funded operations (register, submit, claims, settlement)
- Preview-only trading on real Panta markets
- Requires `PANTA_API_KEY`
- Labeled "Real Panta data · simulated settlement" in UI

### live
- Everything real (requires funded setup)
- All operations go to Panta API
- Requires `PANTA_API_KEY` and real wallet

## What is Simulated

The following features are simulated in all modes unless `PANTA_MODE=live` and proper credentials are provided:

- **Market resolution**: A "Sim resolver (stands in for Panta's oracle)" resolves markets in sim/hybrid modes
- **Creator fee graduation**: Markets graduate at `SIM_GRADUATION_VOLUME` (configurable, default 100)
- **Wallet signatures**: Demo wallet uses browser-generated ed25519 keypairs (play money only)
- **Settlement**: Winnings are paid from the simulator balance, not real USDC

## Troubleshooting

### Port conflicts
- API server tries port 4000, increments if busy
- Web app tries port 5173, increments if busy

### PGlite issues
- Development uses `.data/pglite` for persistence
- Tests use in-memory PGlite
- Delete `.data/pglite` to reset development database

### Render sleep
- Backend on Render free tier sleeps after 15 min idle
- Frontend shows "Waking the server…" with automatic retry/backoff
- `/health` endpoint available without DB connection

## Scripts

- `pnpm dev` - Start both server and web in parallel
- `pnpm build` - Build web for production
- `pnpm lint` - Run ESLint
- `pnpm test` - Run server tests
- `pnpm smoke` - Run end-to-end smoke test
- `pnpm check:secrets` - Check for leaked API keys

## Deployment

### Backend (Render)
- Build: No build step required
- Start: `npm start` (runs `node src/server.js`)
- Environment variables: See section above
- Health check: `/health`

### Frontend (Netlify/Vercel)
- Build: `pnpm --filter web build`
- Output: `web/dist`
- SPA fallback: Add redirect rule for all routes to `index.html`

## Security Notes

- Guest wallet secret keys are stored in `localStorage` (play money only - never do this for real keys)
- JWT tokens stored in `sessionStorage`
- All Panta API keys must remain server-side
- Never commit `.env` or secrets to git
