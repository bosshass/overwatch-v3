-- ============================================================
-- 028 — notes: standalone notes that never become jobs
-- ============================================================
-- WHY A NEW TABLE
--   Every note in Overwatch today lives in `job_history.notes`, which means a
--   note cannot exist without a job. Shana's notes are the opposite: they are
--   never jobs and must never appear on the board. Forcing them through
--   job_history would either create junk job rows or lose the notes.
--
--   `customersApi.addNote()` was the other candidate and it is quietly broken:
--   it attaches the note to the customer's most recent JOB, and if the customer
--   has no jobs it returns undefined and writes nothing. A note Shana files
--   against a client with no job history would silently disappear. This table
--   holds the customer link itself, so that failure mode is gone.
--
-- LIFECYCLE
--   open  → Shana is still working it
--   archived → she marked it done. On the way out she is asked whether it
--              belongs on a client record; `on_customer_record = true` means
--              yes, and it stays queryable against that customer forever.
--   Nothing is ever deleted — archived notes stay searchable.
-- ============================================================

CREATE TABLE IF NOT EXISTS notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body                text NOT NULL,
  author_email        text,
  -- Optional at creation. Can be set later, or at archive time via the
  -- "add this to a client record?" prompt.
  customer_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- TRUE only when Shana explicitly said this belongs on the client's record.
  -- A note can carry a customer_id for context WITHOUT being filed on the
  -- record, so the customer view isn't polluted with scratch notes.
  on_customer_record  boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','archived')),
  archived_at         timestamptz,
  archived_by         text,
  -- Set when a note was imported from a Google Calendar event, so a re-run of
  -- the import can't duplicate it. NULL for hand-typed notes. See 029.
  source_event_id     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The three ways this table gets read: my open list, my archive, one client's record.
CREATE INDEX IF NOT EXISTS notes_status_created_idx
  ON notes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_author_idx
  ON notes (author_email, status);
CREATE INDEX IF NOT EXISTS notes_customer_record_idx
  ON notes (customer_id) WHERE on_customer_record = true;

-- Archive search is a text scan over body. Trigram beats LIKE '%x%' once this
-- table has a few hundred rows, and pg_trgm is already available on Supabase.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS notes_body_trgm_idx
  ON notes USING gin (body gin_trgm_ops);

CREATE OR REPLACE FUNCTION notes_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_touch ON notes;
CREATE TRIGGER notes_touch BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- NOTE: this matches the permissive posture of every other table in this
-- database (jobs, customers and time_entries are all `USING (true)`), so it
-- is not making anything worse. It is also not making it better — see the
-- separate RLS conversation. When those policies get scoped to a real auth
-- identity, this table should be scoped in the same pass, with notes readable
-- by their author and by operators.
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_all ON notes;
CREATE POLICY notes_all ON notes FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON notes TO anon, authenticated;
