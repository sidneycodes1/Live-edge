-- 005_fee_events.sql — creation fee deduction (F-010 / T5, Phase 3.1)
--
-- Market creation now charges a real fee that is deducted from the creator's
-- balance. Like the faucet/welcome mints in 004, this debit had no per-event
-- history, so it is journaled here (append-only) and folded into GET /api/ledger
-- as a negative delta. The authoritative balance is still balances.sim_usdc alone;
-- this table never recomputes it. `amount` is stored positive (the fee magnitude);
-- the ledger renders it as a debit.
create table if not exists fee_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('creation_fee')),
  amount numeric not null check (amount > 0),
  market_id uuid references markets(id),
  created_at timestamptz default now()
);

create index if not exists idx_fee_events_user_created on fee_events (user_id, created_at desc);
