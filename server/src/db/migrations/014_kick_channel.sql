-- 014: Kick replaces Twitch as the real-stream provider (Oct 2026).
-- Renames the room channel binding; existing bindings are kept as-is (a bound
-- login/slug is just a string — rooms pointed at dead Twitch logins simply
-- render the honest offline state until a creator binds a Kick channel).
alter table rooms rename column twitch_channel to kick_channel;
alter index rooms_twitch_channel_idx rename to rooms_kick_channel_idx;
