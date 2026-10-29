-- 0003_assets_publish.sql
-- Lumen Engine Phase 21 — media assets and publish records:
--   assets, asset_jobs, publishes
-- Idempotent: create table if not exists. RLS is enabled in 0007_rls.sql.

-- ---------------------------------------------------------------------------
-- assets (uploaded media; path in storage: {owner_id}/{project_id}/{asset_id}/...)
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('video', 'image')),
  status     text not null default 'pending'
             check (status in ('pending', 'processing', 'done', 'failed')),
  manifest   jsonb,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists assets_project_id_idx on public.assets (project_id);
create index if not exists assets_owner_id_idx on public.assets (owner_id);

-- ---------------------------------------------------------------------------
-- asset_jobs (worker queue; workers use `select ... for update skip locked`)
-- ---------------------------------------------------------------------------
create table if not exists public.asset_jobs (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references public.assets (id) on delete cascade,
  ops        text[] not null,
  status     text not null default 'queued'
             check (status in ('queued', 'running', 'done', 'failed')),
  progress   int not null default 0 check (progress between 0 and 100),
  result     jsonb,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists asset_jobs_status_idx
  on public.asset_jobs (status) where status = 'queued';
create index if not exists asset_jobs_asset_id_idx on public.asset_jobs (asset_id);

-- ---------------------------------------------------------------------------
-- publishes (static deploys; bundle in `bundles` bucket at
--   {project_id}/{publish_id}/...)
-- ---------------------------------------------------------------------------
create table if not exists public.publishes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  deployment_id text,
  url           text,
  config_hash   text,
  bundle_path   text,
  status        text not null default 'live'
                check (status in ('live', 'rolled-back')),
  created_at    timestamptz not null default now()
);
create index if not exists publishes_project_id_idx
  on public.publishes (project_id, created_at desc);
