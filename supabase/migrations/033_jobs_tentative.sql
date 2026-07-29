-- ============================================================
-- 033 — jobs.tentative_date / tentative_event_id
-- ============================================================
-- WHY
--   "Tentatively schedule" in My Tasks wrote a date onto Shana's private note
--   and nothing else. No calendar event, no change to the job, nothing on the
--   board. From her side it looked like the app had eaten the action — she
--   pencilled in Rick Ferreri and nothing anywhere showed it had happened.
--
--   A tentative hold is a real business state: committed enough to tell a
--   customer, not committed enough to dispatch a tech. It belongs on the JOB,
--   where everyone can see it, not buried in one person's note.
--
--   Distinct from `scheduled_date` on purpose. scheduled_date means a tech is
--   booked and the work is happening. tentative_date means somebody is holding
--   the slot. Collapsing them would make a pencil mark look like a commitment,
--   which is exactly the mistake that puts two crews in one place.
-- ============================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tentative_date timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tentative_event_id text;

COMMENT ON COLUMN jobs.tentative_date IS
  'Pencilled-in date on the Tent calendar. NOT a dispatch — scheduled_date is '
  'the committed one. Cleared when the job is actually scheduled.';

CREATE INDEX IF NOT EXISTS jobs_tentative_idx
  ON jobs (tentative_date) WHERE tentative_date IS NOT NULL;
