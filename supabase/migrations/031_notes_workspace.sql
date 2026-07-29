-- ============================================================
-- 031 — notes become workspace items (lanes, job link, tentative schedule)
-- ============================================================
-- WHY
--   Shana's workspace was rendering `jobs` rows directly into To Do / Doing /
--   Done. That made her lanes a second skin on the board: her columns were
--   just job.status renamed, so she could not move anything without changing
--   the job, and "Done" meant the company's billing pipeline rather than her
--   own finished work.
--
--   What she actually needs is HER OWN board that can POINT AT a job:
--     • To Do  — a feed of work where she is the next action (still read from
--                jobs), plus her own open notes
--     • Doing  — hers alone. She puts things here. Nothing else does.
--     • Done   — her finished notes and her scheduled items. Not billing.
--
--   The hard rule this migration exists to enforce: moving her card must never
--   touch the job. `job_id` is a REFERENCE, not ownership. A job sitting in
--   ready_to_schedule stays there whether or not Shana has pulled it into her
--   Doing column, because the board is the company's view and this is hers.
--
-- TENTATIVE SCHEDULING
--   Shana's "Tent" calendar is the real scheduling instrument and stays the
--   source of truth. She can mark one of her items tentatively scheduled and
--   link the calendar event, which records HER intent without creating a
--   dispatch. Nothing here writes to a tech's calendar or moves a job to
--   scheduled — that still happens through the normal scheduling flow.
-- ============================================================

-- Her column. Independent of jobs.status, on purpose.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'todo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_lane_check'
  ) THEN
    ALTER TABLE notes ADD CONSTRAINT notes_lane_check
      CHECK (lane IN ('todo','doing','done'));
  END IF;
END $$;

-- Optional pointer at a board job. ON DELETE SET NULL: if the job is ever
-- removed her note survives, because the note is hers and the job was context.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;

-- Tentative scheduling — her intent, not a dispatch.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS tentative boolean NOT NULL DEFAULT false;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS calendar_event_id text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS calendar_id text;

COMMENT ON COLUMN notes.job_id IS
  'Optional reference to a board job. Moving this note between lanes must NEVER '
  'change jobs.status — the board is the company view, notes are the owner''s view.';
COMMENT ON COLUMN notes.tentative IS
  'Owner has pencilled this in on the Tent calendar. Not a dispatch and not a '
  'scheduled job.';

-- Anything already archived is finished work: that is her Done column.
UPDATE notes SET lane = 'done' WHERE status = 'archived' AND lane <> 'done';

CREATE INDEX IF NOT EXISTS notes_lane_author_idx ON notes (author_email, lane, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_job_idx ON notes (job_id) WHERE job_id IS NOT NULL;
