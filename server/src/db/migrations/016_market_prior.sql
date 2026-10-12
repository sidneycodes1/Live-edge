-- Gemini opening line (owner fix, Oct 2026): every landing market used to open at a
-- flat "YES 50% / NO 50%" because a fresh sim-engine row sits at q_yes=q_no=0 and the
-- uniform LMSR price at zero is exactly 0.5. The bar was already price-driven - there
-- was simply no signal. This adds a per-market PRIOR so a broadcast-aligned market can
-- open at the model's honest estimate instead of dead-even.
--
-- prior_yes is the LMSR-with-prior weight pi_yes (pi_no = 1 - pi_yes). The prior-aware
-- curve (server/src/sim/lmsr.js) delegates to the EXACT uniform math whenever this is
-- 0.5, so every existing sim/panta row - and the F-009 money-conservation bound - is
-- byte-for-byte unchanged. Only sim-engine markets the engine stamps with a non-0.5
-- line take the new path. Binary LMSR worst-case loss stays B*ln(2) for ANY prior, so
-- this never mints play money from nothing.
--
-- Additive + idempotent: a NOT NULL DEFAULT 0.5 back-fills every existing row to the
-- uniform opening it already had. The CHECK keeps the log-odds finite (open interval).
alter table markets add column if not exists prior_yes numeric not null default 0.5
  check (prior_yes > 0 and prior_yes < 1);
