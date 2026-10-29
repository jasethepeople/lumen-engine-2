-- 0001_extensions.sql
-- Lumen Engine Phase 21 — extensions
-- Prerequisite extensions for the schema. Idempotent.

-- gen_random_uuid() lives in pgcrypto on Postgres < 13; on 13+ it is in core,
-- but enabling pgcrypto is harmless and keeps compatibility.
create extension if not exists pgcrypto with schema extensions;

-- pg_cron is used for scheduled jobs (see 0009_cron.sql). It is enabled by
-- default on Supabase projects; if it is not available in your environment
-- (e.g. plain local Postgres), comment out the following line and skip
-- 0009_cron.sql — the SQL functions can then be invoked by any external
-- scheduler instead.
create extension if not exists pg_cron with schema pg_catalog;
-- Fallback guard (non-Supabase environments without pg_cron):
--   comment the line above; schedules in 0009_cron.sql will fail gracefully
--   if left applied, so skip that file entirely.

-- pg_net is used by edge-function-style HTTP calls from SQL (optional).
-- On Supabase it can be enabled from the dashboard (Database > Extensions).
-- We only note it here; nothing in these migrations hard-requires it.
-- create extension if not exists pg_net with schema extensions;
