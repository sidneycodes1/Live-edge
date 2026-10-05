-- 012_setup_terms.sql — account-setup + Terms consent (docs/ONBOARDING_PLAN.md §4).
-- Adds the three columns the frozen contract specifies, verbatim. `if not exists`
-- keeps re-runs idempotent (migrate.js applies every *.sql on boot). No table is
-- created, so the test TRUNCATE list is unchanged.
alter table users add column if not exists terms_version text;
alter table users add column if not exists terms_accepted_at timestamptz;
alter table users add column if not exists setup_completed_at timestamptz;
