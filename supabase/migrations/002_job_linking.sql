-- ============================================================
-- Overwatch — Job Linking (P-numbers, S-numbers, job_id FKs)
-- ============================================================
-- Run in Supabase SQL Editor (https://supabase.com/dashboard).
-- Safe to re-run — all statements use IF NOT EXISTS / OR REPLACE.
-- ============================================================

-- ── 1. JOB IDENTITY COLUMNS ─────────────────────────────────
-- p_number: assigned when estimate transitions to estimate_sent (P-001, P-002…)
-- s_number: assigned when a service call gets scheduled on a tech calendar (S-001, S-002…)
-- blocked_tags: operator-set tags for the blocked swimlane

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS p_number TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS s_number TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS blocked_tags TEXT[] DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_p_number ON jobs(p_number) WHERE p_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_s_number ON jobs(s_number) WHERE s_number IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_jobs_status    ON jobs(status);


-- ── 2. JOB_ID ON RETURN CARDS ────────────────────────────────
-- Operator links a return card to a job (P- or S-) from the board.
-- Multiple return cards with the same job_id collapse to one on the board.

ALTER TABLE return_cards ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_return_cards_job_id ON return_cards(job_id);


-- ── 3. JOB_ID ON TIME ENTRIES ────────────────────────────────
-- Set silently when the associated return card is linked, or directly by an operator.
-- Techs never see this — it exists only for grouping in operator/billing views.

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_job_id ON time_entries(job_id);


-- ── 4. P-NUMBER AUTO-ASSIGN TRIGGER ──────────────────────────
-- Fires on any UPDATE that transitions status TO 'estimate_sent'.
-- Does nothing if the job already has a p_number.

CREATE OR REPLACE FUNCTION assign_p_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  IF NEW.status = 'estimate_sent'
     AND (OLD.status IS DISTINCT FROM 'estimate_sent')
     AND NEW.p_number IS NULL
  THEN
    SELECT COALESCE(
      MAX( CAST( SUBSTRING(p_number FROM 3) AS INT ) ), 0
    ) + 1
    INTO next_num
    FROM jobs
    WHERE p_number ~ '^P-[0-9]+$';

    NEW.p_number := 'P-' || LPAD(next_num::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_p_number ON jobs;
CREATE TRIGGER trg_assign_p_number
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION assign_p_number();


-- ── 5. S-NUMBER GENERATION FUNCTION ──────────────────────────
-- Called from the client (BoardView) when a calendar event is detected on a
-- tech calendar (Austin / JR / Brian) and matched to a job in job_assignments.
-- Only assigns if the job has no p_number and no s_number yet.
-- Returns the s_number (new or existing).

CREATE OR REPLACE FUNCTION assign_s_number(target_job_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_num  INT;
  new_s     TEXT;
  existing  RECORD;
BEGIN
  SELECT p_number, s_number INTO existing FROM jobs WHERE id = target_job_id;

  -- Already has a project number — don't overwrite with a service number
  IF existing.p_number IS NOT NULL THEN
    RETURN existing.p_number;
  END IF;

  -- Already has an s_number — return it
  IF existing.s_number IS NOT NULL THEN
    RETURN existing.s_number;
  END IF;

  -- Generate next S-number
  SELECT COALESCE(
    MAX( CAST( SUBSTRING(s_number FROM 3) AS INT ) ), 0
  ) + 1
  INTO next_num
  FROM jobs
  WHERE s_number ~ '^S-[0-9]+$';

  new_s := 'S-' || LPAD(next_num::TEXT, 3, '0');

  UPDATE jobs SET s_number = new_s WHERE id = target_job_id;
  RETURN new_s;
END;
$$;


-- ── 6. LINK TIME ENTRY WHEN RETURN CARD IS LINKED ────────────
-- When an operator sets job_id on a return_card, automatically propagate
-- that job_id to the associated time_entry (if any).

CREATE OR REPLACE FUNCTION sync_time_entry_job_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_id IS NOT NULL AND NEW.time_entry_id IS NOT NULL THEN
    UPDATE time_entries
    SET job_id = NEW.job_id
    WHERE id = NEW.time_entry_id
      AND job_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_time_entry_job_id ON return_cards;
CREATE TRIGGER trg_sync_time_entry_job_id
  AFTER INSERT OR UPDATE OF job_id ON return_cards
  FOR EACH ROW
  EXECUTE FUNCTION sync_time_entry_job_id();
