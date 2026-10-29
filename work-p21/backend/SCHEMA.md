# Lumen SaaS Backend — Schema Contract (binding for migrations, edge functions, client bindings)

Postgres (Supabase). All tables in `public`. `uid()` = `auth.uid()`. Timestamps `timestamptz default now()`.

## Tables

- **profiles**: id uuid pk references auth.users, handle text unique check `^[a-z0-9-]{3,24}$`, display_name text, bio text, avatar_color text, links jsonb default '[]', created_at
- **projects**: id uuid pk default gen_random_uuid(), owner_id uuid references profiles(id), name text, template_kind text, template_id text, config jsonb, shared boolean default false, schema_version int default 1, created_at, updated_at
- **project_versions**: id uuid pk, project_id uuid references projects on delete cascade, version_num int, config jsonb, label text, created_at; unique(project_id, version_num)
- **project_members**: project_id, user_id, role text check in ('owner','editor','viewer'), added_at; pk(project_id,user_id)
- **invitations**: id uuid pk, project_id, email text, role text, token text unique, status text default 'pending' check in ('pending','accepted','revoked','expired'), expires_at, created_at
- **merge_suggestions**: id uuid pk, project_id, user_id, their_version_id uuid, head_version_id uuid, next_config jsonb, fields_changed text[], status text default 'pending', created_at
- **activity_log**: id bigint generated always as identity pk, project_id, actor_id uuid, action text, detail jsonb, created_at
- **assets**: id uuid pk, project_id, owner_id, name text, kind text check in ('video','image'), status text default 'pending' check in ('pending','processing','done','failed'), manifest jsonb, error text, created_at
- **asset_jobs**: id uuid pk, asset_id uuid references assets on delete cascade, ops text[], status text default 'queued' check in ('queued','running','done','failed'), progress int default 0, result jsonb, error text, created_at, updated_at  (queue table; workers `select ... for update skip locked`)
- **publishes**: id uuid pk, project_id, deployment_id text, url text, config_hash text, bundle_path text, status text default 'live' check in ('live','rolled-back'), created_at
- **templates**: id text pk, author_id uuid references profiles(id), name text, description text, template_kind text, version text, categories text[], tags text[], tier text default 'free', price_cents int, currency text default 'usd', entry_config jsonb, thumbnail text, engine_min_version text, created_at, updated_at
- **purchases**: id uuid pk, user_id, template_id text references templates(id), amount_cents int, created_at; unique(user_id, template_id)
- **payouts**: id uuid pk, author_id, amount_cents int, status text default 'scheduled', period_start, period_end, created_at
- **revenue_ledger**: id bigint identity pk, purchase_id uuid references purchases(id), author_id, amount_cents int, creator_cents int, platform_cents int, settled boolean default false, created_at
- **subscriptions**: user_id uuid pk, plan_id text default 'free' check in ('free','pro'), status text default 'active', current_period_end, updated_at
- **comments**: id uuid pk, target_kind text check in ('template','project'), target_id text, author_id, parent_id uuid null references comments(id), body text check length 1..1000, edited_at timestamptz null, deleted_at timestamptz null, created_at
- **remixes**: id uuid pk, original_id text, original_author_id uuid, remixer_id uuid, new_project_id uuid, created_at
- **analytics_events**: id bigint identity pk, project_id, event text, source text, created_at
- **telemetry_events** (opt-in only): id bigint identity pk, user_id, name text, props jsonb, session_id text, created_at

## Storage buckets
- `assets` (private; path `{owner_id}/{project_id}/{asset_id}/...`)
- `bundles` (private; `{project_id}/{publish_id}/...`)
- `thumbnails` (public read)

## Realtime
- Presence channel per project: `presence:project:{id}` (client-side, no table).
- postgres_changes on `merge_suggestions`, `comments`, `asset_jobs` for live UI.

## Cron (pg_cron)
- `settle_payouts` daily 03:00 → calls edge function `payouts` (or SQL fn `settle_scheduled_payouts()`).
- `expire_invitations` hourly → `update invitations set status='expired' where status='pending' and expires_at < now()`.

## Edge functions (backend/functions/)
- `publish-pipeline` — POST {project_id, config} → static bundle → bundles bucket → publishes row. Budget-enforced.
- `asset-pipeline` — worker: drains asset_jobs (skip locked) → optimize → manifest → assets row update.
- `payouts` — settles scheduled payouts (70/30 split rows from revenue_ledger), marks settled.

## Triggers / functions (SQL)
- `projects_after_update` — autosave versioning: on config update, insert project_versions row with next version_num; prune > 50.
- `purchases_after_insert` — insert revenue_ledger row (creator = round(0.7*amount), platform = remainder).
- `handle_updated_at()` — generic updated_at trigger for projects, templates, asset_jobs.

## RLS (summary — full policies in migrations)
- profiles: read all; update own.
- projects: owner full; members per role (viewer select; editor select/update config; owner all + delete).
- project_versions/activity_log/merge_suggestions: members read; editor+ insert.
- invitations: owner manage; accept by token via security-definer fn `accept_invitation(token)`.
- assets/asset_jobs: project members read; editor+ insert; worker uses service role.
- publishes: members read; insert via edge fn (service role).
- templates: read all; author insert/update own.
- purchases: user reads own; insert via mock checkout fn (service role or authenticated self-insert).
- payouts/revenue_ledger: author reads own rows; writes service-role only.
- subscriptions: user reads own; writes service-role only.
- comments: read all non-deleted; insert authenticated; update/delete own.
- remixes: read all; insert authenticated (remixer_id = uid()).
- analytics_events: members read project rows; insert via edge fn.
- telemetry_events: user insert/select own only.
