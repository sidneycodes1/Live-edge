-- 003_notifications.sql — notification center (finishes F-005)
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_notifications_user_created on notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_unread on notifications (user_id, read_at) where read_at is null;
