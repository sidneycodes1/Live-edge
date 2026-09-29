-- 002_identity.sql — email/password accounts layered on guest wallets (F-004)
-- Adds identity columns to the existing users table. Guest wallets keep working
-- unchanged; kind defaults to 'guest' so every existing row stays a guest.

alter table users add column if not exists email text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists kind text not null default 'guest';
alter table users add column if not exists upgraded_at timestamptz;

-- kind is constrained to the two supported account types.
-- Constraint is added idempotently via a guard so re-running on a DB that already
-- has it (real Postgres migration replays) does not error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_kind_check'
  ) then
    alter table users add constraint users_kind_check check (kind in ('guest','email'));
  end if;
end $$;

-- Case-insensitive uniqueness on email.
-- NOTE: `citext` is the natural fit but is NOT available in the PGlite build this
-- app is developed and tested against (confirmed: pg_available_extensions has no
-- 'citext' row). A partial unique index on lower(email) gives the identical
-- case-insensitive guarantee and is portable to real Postgres, so we use that
-- instead of depending on an extension that cannot load under test.
create unique index if not exists users_email_lower_uniq on users (lower(email)) where email is not null;
