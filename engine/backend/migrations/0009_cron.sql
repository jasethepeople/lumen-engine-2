-- 0009_cron.sql
-- Lumen Engine Phase 21 — pg_cron schedules.
-- Requires pg_cron (see 0001_extensions.sql). On Supabase, pg_cron is
-- pre-enabled. Idempotent: unschedule before schedule.

-- ---------------------------------------------------------------------------
-- settle_payouts — daily at 03:00 UTC.
-- Default: call the SQL function settle_scheduled_payouts().
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('settle_payouts');
exception when others then
  -- Job did not exist yet (or cron schema differs); safe to ignore.
  null;
end;
$$;

select cron.schedule(
  'settle_payouts',
  '0 3 * * *',
  $cmd$select public.settle_scheduled_payouts();$cmd$
);

-- Alternative: invoke the `payouts` edge function via pg_net instead.
-- Requires pg_net and the vault-stored service credentials. To use it,
-- comment the schedule above and uncomment below (fill in project ref / key):
--
-- select cron.schedule(
--   'settle_payouts',
--   '0 3 * * *',
--   $cmd$
--     select net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/payouts',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer <service-role-key>'
--       ),
--       body := '{}'::jsonb
--     );
--   $cmd$
-- );

-- ---------------------------------------------------------------------------
-- expire_invitations — hourly.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('expire_invitations');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'expire_invitations',
  '0 * * * *',
  $cmd$select public.expire_invitations();$cmd$
);
