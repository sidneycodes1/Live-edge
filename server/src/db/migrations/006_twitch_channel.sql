-- 006: optional Twitch channel binding for a room.
-- When set, the Room page renders the REAL Twitch video + chat embeds alongside
-- the (still simulated) market panel instead of the animated demo VideoStage.
-- Nullable; existing rooms/markets/claims/money logic is completely unaffected.
alter table rooms add column if not exists twitch_channel text;

-- Lookup by channel (find the room attached to a given Twitch login).
create index if not exists rooms_twitch_channel_idx on rooms (twitch_channel);
