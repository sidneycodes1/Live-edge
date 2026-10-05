-- 011_user_profile.sql — Privy auth + user profile (docs/PRIVY_AUTH_SPEC.md, Data model).
-- Exactly the SQL frozen in the spec: a unique Privy DID per user and a capped
-- interests array. `display_name` already exists (001). No kind change is made —
-- the spec's migration does not touch it, so a Privy-linked wallet user keeps the
-- existing wallet-based 'guest' kind and is distinguished by privy_did / privy_linked.
alter table users add column if not exists privy_did text unique;
alter table users add column if not exists interests jsonb
  not null default '[]'::jsonb
  check (jsonb_typeof(interests) = 'array' and jsonb_array_length(interests) <= 3);
