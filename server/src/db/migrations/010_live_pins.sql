-- Live pins (feature/live-pins): a user pins a live stream they're watching/playing
-- with; pinned streams lead the "Live now" grid. Hard cap of 4 is enforced in the
-- route (not the DB) so the error is a clean 409 PIN_LIMIT. The payload snapshot is
-- deliberately kept: a pin must still render when its stream has rotated out of the
-- live grid — it shows the LAST REAL fields, never invented ones (§4 honesty).
create table if not exists live_pins(
  user_id uuid not null references users(id) on delete cascade,
  stream_id text not null,
  source text not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, stream_id)
);

create index if not exists live_pins_user_idx on live_pins(user_id, created_at);
