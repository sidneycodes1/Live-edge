-- 004_mint_events.sql — transaction history / ledger (F-006)
--
-- The `trades` table already records every SPEND/EARN event (buy, claim,
-- creator_fee_claim) — that is the existing balance-record source we read the
-- ledger from. The two money IN flows (the $100 welcome bonus and faucet
-- top-ups) had NO per-event history (faucet only stamped `last_faucet_at`, and
-- the welcome mint was just the `balances.sim_usdc` default), so GET /api/ledger
-- could not list them and the Phase 4.1 invariant ("total ever minted = welcome
-- + faucet") had nothing to sum.
--
-- This table is an append-only journal of those mints ONLY. It is NOT a parallel
-- accounting ledger: the authoritative spendable balance still lives solely in
-- `balances.sim_usdc` and is never recomputed from these rows.
create table if not exists mint_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('welcome','faucet')),
  amount numeric not null check (amount > 0),
  created_at timestamptz default now()
);

create index if not exists idx_mint_events_user_created on mint_events (user_id, created_at desc);
