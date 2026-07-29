-- 006_tech_phone.sql
-- Adds a phone number column to techs so the "assign to" flow can send
-- a text message notification (via /api/send-sms) when a job is assigned.

ALTER TABLE techs ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN techs.phone IS 'Mobile number for SMS assignment notifications, e.g. +17195551234. Nullable — techs without a phone on file fall back to a manual "text them yourself" link.';
