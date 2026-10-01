-- 007 (Agent C / data): make room `category`, real-vs-demo `source`, and the
-- football `watch_party` mode FIRST-CLASS, QUERYABLE facts on `rooms`.
--
-- Why: the football rail + honest empty states need real data shapes at the DB
-- layer, not values inferred per-request in the UI. See the frozen contract
-- docs/live-aggregation-spec.md §2 (football = watch-party: markets + chat, NO
-- hosted stream) and §9 (Agent C owns rooms.category/source/watch_party).
--
-- Additive + defaulted so existing rooms keep working; no money/market/claim
-- logic touched. `source` is derived HONESTLY from the pre-existing
-- twitch_channel binding (nothing becomes 'real' unless a channel is actually
-- bound — we never fabricate a live channel, §4).
alter table rooms add column if not exists category text not null default 'gaming';
alter table rooms add column if not exists source text not null default 'demo' check (source in ('real','demo'));
alter table rooms add column if not exists watch_party boolean not null default false;

-- Backfill real-vs-demo from the only trustworthy signal already on the row: a
-- bound Twitch channel. Rooms with no channel stay 'demo'.
update rooms set source = 'real' where twitch_channel is not null and twitch_channel <> '';

-- Category rails and real/demo filters are read on every Discover/room query;
-- index them so they stay cheap, queryable facts rather than computed columns.
create index if not exists rooms_category_idx on rooms (category);
create index if not exists rooms_source_idx on rooms (source);
create index if not exists rooms_watch_party_idx on rooms (watch_party);
