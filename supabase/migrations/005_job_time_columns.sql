-- ============================================================
-- Overwatch — Fix A: time on the job row (NakedPM)
-- Adds completion time columns to jobs so notes+time persist
-- on the JOB (what the board reads), not only on assignments.
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_in      TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_out     TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_hours NUMERIC;

-- completion_notes already exists on jobs (changeStatus writes it).
-- No backfill needed; new completions populate these going forward.
