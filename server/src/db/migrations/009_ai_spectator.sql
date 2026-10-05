-- 009_ai_spectator.sql — labeled AI spectator chat (services/aiChat.js).
-- 1) chat_messages.kind gains 'ai'. The CHECK was declared inline in 001, so it
--    carries the auto-name chat_messages_kind_check; drop+re-add keeps replay safe.
-- 2) display_name carries the synthetic persona label for AI rows (real users
--    still resolve through the users join). Nullable; length-bounded.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'chat_messages_kind_check'
  ) then
    alter table chat_messages drop constraint chat_messages_kind_check;
  end if;
end $$;

alter table chat_messages add constraint chat_messages_kind_check check (kind in ('chat','trade','system','ai'));

alter table chat_messages add column if not exists display_name text
  check (display_name is null or length(display_name) between 1 and 40);
