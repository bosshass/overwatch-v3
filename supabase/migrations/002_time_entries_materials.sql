-- Add materials field to time_entries
-- Techs can log parts/supplies used or needed on any job finish action.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS materials TEXT;
