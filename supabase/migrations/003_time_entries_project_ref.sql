-- Project reference tag for multi-tech / multi-day jobs (Option A)
-- Events tagged [PROJ-NNN] on GCal have the ref auto-extracted when a
-- time entry is written, so all days/techs group under one project.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS project_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_time_entries_project_ref ON time_entries(project_ref) WHERE project_ref IS NOT NULL;
