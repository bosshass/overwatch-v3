-- ============================================================
-- Overwatch V6.2 — Time Entries + Return Cards
-- ============================================================
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS guards).
-- ============================================================

-- ── TIME ENTRIES ─────────────────────────────────────────────
-- Every tech finish action writes one row here.
-- This becomes the "Needs to Bill" queue when disposition='bill_it'
-- and becomes the "Project Queue" when disposition='in_progress'.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer link (nullable — "needs review" if not linked)
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name_raw TEXT,  -- raw name from calendar event if no match

  -- Calendar event this finish applies to
  calendar_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_title TEXT,
  event_start TIMESTAMPTZ,

  -- Who did the work
  tech_email TEXT,
  tech_name TEXT,

  -- The actual time data
  time_in TIMESTAMPTZ,
  time_out TIMESTAMPTZ,
  total_minutes INT NOT NULL DEFAULT 0,
  entry_method TEXT CHECK (entry_method IN ('manual','inout','timer')),

  -- Disposition drives which queue this belongs to
  disposition TEXT NOT NULL CHECK (disposition IN ('bill_it','return','estimate','in_progress')),

  -- Tech notes for this finish
  notes TEXT,

  -- Billing tracking (for Bill It / Estimate flows)
  billed BOOLEAN NOT NULL DEFAULT false,
  billed_at TIMESTAMPTZ,
  invoice_ref TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_customer   ON time_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_event      ON time_entries(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_disposition ON time_entries(disposition);
CREATE INDEX IF NOT EXISTS idx_time_entries_unbilled   ON time_entries(disposition, billed) WHERE billed = false;
CREATE INDEX IF NOT EXISTS idx_time_entries_tech       ON time_entries(tech_email, created_at DESC);


-- ── RETURN CARDS ─────────────────────────────────────────────
-- Created when a tech flags a job as "Return Needed".
-- Feeds the Scheduler view's returns queue.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name_raw TEXT,

  -- The original job that spawned this return
  original_event_id TEXT NOT NULL,
  original_calendar_id TEXT NOT NULL,
  original_event_title TEXT,
  original_location TEXT,

  -- Who flagged it and why
  flagged_by_email TEXT,
  flagged_by_name TEXT,
  reason TEXT,

  -- Link back to the time entry where the return was flagged
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,

  -- Scheduling state
  status TEXT NOT NULL DEFAULT 'pending_schedule'
    CHECK (status IN ('pending_schedule','scheduled','cancelled','complete')),
  scheduled_at TIMESTAMPTZ,
  new_event_id TEXT,
  new_calendar_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_cards_status   ON return_cards(status);
CREATE INDEX IF NOT EXISTS idx_return_cards_customer ON return_cards(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_cards_pending  ON return_cards(status, created_at DESC) WHERE status = 'pending_schedule';


-- ── RLS POLICIES ─────────────────────────────────────────────
-- Matches the permissive pattern used elsewhere in this project.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS time_entries_all ON time_entries;
CREATE POLICY time_entries_all ON time_entries FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS return_cards_all ON return_cards;
CREATE POLICY return_cards_all ON return_cards FOR ALL USING (true) WITH CHECK (true);


-- ── updated_at TRIGGER for return_cards ──────────────────────
CREATE OR REPLACE FUNCTION touch_return_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_return_cards_updated_at ON return_cards;
CREATE TRIGGER trg_return_cards_updated_at
  BEFORE UPDATE ON return_cards
  FOR EACH ROW EXECUTE FUNCTION touch_return_cards_updated_at();
