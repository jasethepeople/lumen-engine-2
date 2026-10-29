# Lumen Engine — Database Migrations (Phase 21)

Ordered, idempotent SQL migrations implementing `backend/SCHEMA.md`.

## Apply order

| File | Contents |
| --- | --- |
| `0001_extensions.sql` | pgcrypto; pg_cron (commented guard for non-Supabase); pg_net note |
| `0002_core_tables.sql` | profiles, projects, project_versions, project_members, invitations, merge_suggestions, activity_log |
| `0003_assets_publish.sql` | assets, asset_jobs, publishes |
| `0004_marketplace_billing.sql` | templates, purchases, payouts, revenue_ledger, subscriptions |
| `0005_social_analytics.sql` | comments, remixes, analytics_events, telemetry_events |
| `0006_functions_triggers.sql` | handle_updated_at(), autosave versioning, purchase revenue split, accept_invitation(), expire_invitations(), settle_scheduled_payouts() |
| `0007_rls.sql` | enable RLS on all tables + full policy set |
| `0008_storage.sql` | storage buckets (assets, bundles, thumbnails) + storage.objects policies |
| `0009_cron.sql` | pg_cron schedules: settle_payouts (daily 03:00), expire_invitations (hourly) |

Files are strictly ordered by prefix and must be applied in that order —
later files depend on tables/functions from earlier ones.

## Prerequisites

- Postgres 15 (Supabase).
- Supabase-managed schemas `auth` and `storage` (present on any Supabase project).
- Extensions: `pgcrypto` (default on Supabase), `pg_cron` (default on Supabase).
  On plain Postgres without pg_cron, skip `0009_cron.sql` and schedule
  `select public.expire_invitations();` / `select public.settle_scheduled_payouts();`
  with any external scheduler.
- `pg_net` is only needed if you switch the cron payout job to call the
  `payouts` edge function (see comments in `0009_cron.sql`).

## Running

### Supabase CLI (linked project)

These files are plain SQL; to use the CLI migration runner, place them under
`supabase/migrations/` with timestamp prefixes (or symlink this directory),
then:

```sh
supabase link --project-ref <ref>
supabase db push
```

For a local stack: `supabase start` then `supabase db reset` (replays all migrations).

### Raw psql

```sh
for f in 00*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

Use the pooled/direct connection string of your project. Run as a role with
sufficient privileges (on Supabase, the `postgres` role) since the migrations
create triggers on `auth.users`-referencing tables, security-definer
functions, storage buckets, and cron jobs.

## Idempotency & rollback

- Tables: `create table if not exists`; indexes: `create index if not exists`.
- Policies: `drop policy if exists` before `create policy`.
- Functions/triggers: `create or replace function` / `drop trigger if exists`.
- Buckets: `insert ... on conflict (id) do nothing`.
- Cron: `cron.unschedule(...)` guarded in a `do` block before re-scheduling.

There are no down migrations. To roll back, drop the created objects in
reverse order (`0009` → `0002`), e.g. `drop table ... cascade` per table and
`cron.unschedule('settle_payouts')`, `cron.unschedule('expire_invitations')`.
Re-applying after partial application is safe due to idempotency.
