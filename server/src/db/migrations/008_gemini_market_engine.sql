-- Phase 2 — broadcast-aligned market engine (server/src/services/marketEngine.js).
-- Additive only: nothing here changes the shape any existing 'sim'/'panta' row or
-- test depends on. Three concerns, all idempotent-safe:

-- (1) Admit engine-generated markets through the existing `source` FLAG (TASK 3
--     demotes/orders by it, and it is cheaper + cleaner than a parallel boolean).
--     The original inline CHECK auto-named `markets_source_check` (only 'sim','panta');
--     widen it to also accept 'sim-engine'. Existing rows already satisfy it.
alter table markets drop constraint if exists markets_source_check;
alter table markets add constraint markets_source_check
  check (source in ('sim', 'panta', 'sim-engine'));

-- (2) Stream-tie columns: WHICH live stream each generated market belongs to, so
--     the web can render "which stream this bet belongs to" (thumbnail already lives
--     in image_url). Nullable + unlabeled for non-engine rows (all stay NULL).
--     `engine_live_item_id` is the aggregator/curated namespaced id (e.g. 'yt-<vid>',
--     'twitch:<streamId>'); videoId/channelSlug/watchUrl are the resolved handles.
alter table markets add column if not exists engine_live_item_id text;
alter table markets add column if not exists engine_video_id text;
alter table markets add column if not exists engine_channel_slug text;
alter table markets add column if not exists engine_watch_url text;

-- (3) Authoritative per-day Gemini budget counter (max 40 calls/day). Keyed by UTC
--     day so it self-resets at midnight with no scheduler; persisted here (in ADDITION
--     to the engine's in-memory mirror) so a restart cannot silently re-spend budget.
create table if not exists engine_budget (
  day text primary key,
  calls integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Partial index for the two hot engine reads: "open sim-engine markets" (dedup/rotate
-- gate) and the trending/closing rails that filter on source + status.
create index if not exists idx_markets_source_status on markets (source, status);
