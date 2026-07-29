-- ============================================================
-- 032 — My Tasks: the Watching lane
-- ============================================================
-- WHY
--   Handing work to someone else currently means losing sight of it. Shana
--   reassigns a job and it vanishes from her screen — but she is still the one
--   the customer calls, and she still needs to know when it moves. "Assigned to
--   somebody else" and "no longer my problem" are different things, and the
--   app only modelled the first.
--
--   Watching covers three states that behave identically from her side:
--   waiting on someone, blocked by someone, or just keeping an eye on it. She
--   does not own the next action but she needs the status.
--
-- `last_seen_status` is what makes it useful rather than a bookmark. It records
--   the job's status when she started watching, so the card can show
--   "ready_to_schedule → scheduled" instead of just repeating today's status.
--   Without it a watched card tells her nothing she couldn't get from the board.
-- ============================================================

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_lane_check;
ALTER TABLE notes ADD CONSTRAINT notes_lane_check
  CHECK (lane IN ('todo','doing','done','watching'));

-- The job's status at the moment watching began. Compared against the live
-- status to show movement.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS last_seen_status text;

COMMENT ON COLUMN notes.last_seen_status IS
  'jobs.status when this card entered the watching lane. Diffed against the '
  'live status so the card shows what MOVED, not just where it is.';

-- One watch per person per job. Watching the same job twice is never intended
-- and would show her a duplicate card.
CREATE UNIQUE INDEX IF NOT EXISTS notes_watch_uidx
  ON notes (author_email, job_id)
  WHERE lane = 'watching' AND job_id IS NOT NULL;
