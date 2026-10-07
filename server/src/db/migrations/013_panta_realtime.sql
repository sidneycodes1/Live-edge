-- 013_panta_realtime.sql — Panta real-time integration (Door 1: real data, simulated money).
--
-- Additive + idempotent-safe (pglite `exec` runs this whole file). NOTHING here
-- changes the shape or money math any existing 'sim' / 'sim-engine' / seed row or
-- test depends on. Money columns stay integer/numeric micro-unit style; NO cash
-- path is introduced, so the play-money conservation invariant is unaffected.
--
-- Three concerns:
--   (1) Provenance + freshness on `markets` so the UI can HONESTLY label where a
--       price came from (ToU §5 / the project honesty law): 'panta_live' (observed
--       from Panta within the TTL), 'stale_panta' (last-known but older than the
--       TTL), or 'simulated' (our own bounded movement / our local LMSR). Default
--       is 'simulated' — the honest truth for every pre-existing local row.
--   (2) Panta READ mirrors (namespace-prefixed `panta_*` so they NEVER collide with
--       our own settlement columns like `graduated` / `outcome` / `status`). These
--       are display/label inputs only; our ledger never trusts them for money.
--   (3) Two cache tables the poller owns: `panta_markets` (last-known Panta snapshot
--       per market, for honest degrade) and `panta_sync_state` (a single-row cursor
--       / read-budget bookkeeping record).

-- (1) Price provenance + freshness ------------------------------------------------
alter table markets add column if not exists price_source text not null default 'simulated'
  check (price_source in ('panta_live', 'simulated', 'stale_panta'));
alter table markets add column if not exists price_observed_at timestamptz;

-- (2) Panta read mirrors (all nullable; NULL for non-Panta rows) ------------------
alter table markets add column if not exists panta_phase text;               -- primary | secondary | resolved
alter table markets add column if not exists panta_status text;              -- Panta's own status string
alter table markets add column if not exists panta_resolved boolean;         -- oracle resolved the outcome
alter table markets add column if not exists panta_yes_wins boolean;         -- resolved YES/NO (when resolved)
alter table markets add column if not exists panta_oracle text;             -- oracle id/name (e.g. UMA)
alter table markets add column if not exists panta_graduated boolean;        -- Panta liquidity graduation
alter table markets add column if not exists panta_total_volume_usdc numeric; -- REAL Panta volume (display only)
alter table markets add column if not exists panta_creator_address text;
alter table markets add column if not exists panta_is_whitelisted_creator boolean;

-- A Panta-sourced market maps 1:1 to a real Panta market id. The poller UPSERTs on
-- this, so it must be UNIQUE among the rows that carry it (all local rows keep NULL).
create unique index if not exists idx_markets_panta_market_id
  on markets (panta_market_id) where panta_market_id is not null;

-- Hot read for the source/label rails (and the poller's "which markets are live").
create index if not exists idx_markets_price_source on markets (price_source);

-- (3) Poller-owned cache tables ---------------------------------------------------

-- Last-known Panta snapshot per market: keeps the raw row + the projected fields so
-- an unreachable upstream can degrade to "show the last real price, marked stale"
-- instead of fabricating or blanking. Never a money source.
create table if not exists panta_markets (
  panta_market_id text primary key,
  row jsonb not null,
  question text,
  title text,
  category text,
  image_url text,
  phase text,
  status text,
  yes_price numeric,
  no_price numeric,
  price_source text,
  resolved boolean,
  yes_wins boolean,
  total_volume_usdc numeric,
  observed_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Single-row poller bookkeeping (cursor pagination + read-budget mirror + last error).
-- The CHECK forces the singleton; the poller UPSERTs on id=1.
create table if not exists panta_sync_state (
  id integer primary key default 1 check (id = 1),
  last_cursor text,
  last_success_at timestamptz,
  last_error text,
  remaining_reads integer,
  updated_at timestamptz default now()
);
