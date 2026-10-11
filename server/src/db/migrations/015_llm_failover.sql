-- LLM failover chain (server/src/services/llm/chain.js). The broadcast market engine
-- now draws from a provider chain (Gemini -> Cloudflare -> OpenRouter) instead of
-- Gemini alone, so each provider needs its OWN per-day call budget. The engine keeps
-- its existing aggregate `engine_budget` (a runaway guard across all providers); this
-- table tracks the AUTHORITATIVE per-provider spend so one provider exhausting its
-- quota can never stop the chain from trying the next.
--
-- Keyed by (provider, UTC day) so each provider self-resets at midnight with no
-- scheduler, and a restart cannot silently re-spend budget (same durability rationale
-- as engine_budget in migration 008). Additive only — nothing here changes any
-- existing table, row shape, or test.
create table if not exists llm_budget (
  provider text not null,
  day text not null,
  calls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, day)
);
