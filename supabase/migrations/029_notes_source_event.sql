-- ============================================================
-- 029 — notes.source_event_id
-- ============================================================
-- The one-time import from Shana's Google Calendar can be run more than once
-- (she'll re-open the screen, or a second event will appear later). Without a
-- key back to the calendar event, every run would re-insert the same notes.
--
-- Idempotent, so it is safe whether or not 028 has already been applied.
-- ============================================================

ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_event_id text;

-- Partial unique index: NULL for hand-typed notes (unbounded), unique for
-- anything that came from a calendar event.
CREATE UNIQUE INDEX IF NOT EXISTS notes_source_event_uidx
  ON notes (source_event_id) WHERE source_event_id IS NOT NULL;
