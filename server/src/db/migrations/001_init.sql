create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now());

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet text unique not null,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists auth_nonces (
  wallet text primary key,
  nonce text not null,
  expires_at timestamptz not null
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  title text not null check (length(title) between 3 and 80),
  video_url text,
  status text not null default 'live' check (status in ('live','offline')),
  is_seed boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists markets (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id),
  creator_id uuid not null references users(id),
  source text not null check (source in ('sim','panta')),
  panta_market_id text,
  question text not null check (length(question) between 8 and 140),
  resolution_rule text not null,
  sources_of_truth text[] not null check (array_length(sources_of_truth,1) >= 1),
  category text not null default 'gaming',
  image_url text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  resolution_time timestamptz not null,
  q_yes numeric not null default 0,
  q_no numeric not null default 0,
  yes_price numeric not null default 0.5,
  no_price numeric not null default 0.5,
  volume numeric not null default 0,
  status text not null default 'open' check (status in ('open','closed','resolved')),
  outcome text check (outcome in ('yes','no')),
  graduated boolean not null default false,
  creator_fees_accrued numeric not null default 0,
  creator_fees_claimed boolean not null default false,
  is_seed boolean not null default false,
  created_at timestamptz default now(),
  unique (creator_id, question)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  market_id uuid not null references markets(id),
  side text not null check (side in ('yes','no')),
  amount numeric not null check (amount > 0),
  fee numeric, shares numeric, quoted_price numeric,
  max_slippage_bps int not null default 100,
  status text not null default 'quoted' check (status in ('quoted','built','confirmed','expired','failed')),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  market_id uuid not null references markets(id),
  order_id uuid references orders(id),
  kind text not null check (kind in ('buy','claim','creator_fee_claim')),
  side text, amount numeric, shares numeric,
  signature text unique not null,
  is_seed boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists balances (user_id uuid primary key references users(id), sim_usdc numeric not null default 100 check (sim_usdc >= 0), last_faucet_at timestamptz);

create table if not exists positions (
  user_id uuid references users(id),
  market_id uuid references markets(id),
  yes_shares numeric not null default 0,
  no_shares numeric not null default 0,
  claimed boolean not null default false,
  primary key (user_id, market_id)
);

create table if not exists chat_messages (
  id bigserial primary key,
  room_id uuid not null references rooms(id),
  user_id uuid references users(id),
  kind text not null default 'chat' check (kind in ('chat','trade','system')),
  body text not null check (length(body) <= 280),
  is_seed boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists idx_markets_room_status on markets (room_id, status);
create index if not exists idx_trades_market_created on trades (market_id, created_at desc);
create index if not exists idx_chat_room_id on chat_messages (room_id, id desc);
