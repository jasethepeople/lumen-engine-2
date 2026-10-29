-- 0005_social_analytics.sql
-- Lumen Engine Phase 21 — social and analytics:
--   comments, remixes, analytics_events, telemetry_events
-- Idempotent: create table if not exists. RLS is enabled in 0007_rls.sql.

-- ---------------------------------------------------------------------------
-- comments (threaded, soft-deletable, on templates or projects)
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('template', 'project')),
  target_id   text not null,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  parent_id   uuid references public.comments (id) on delete cascade,
  body        text not null check (length(body) between 1 and 1000),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists comments_target_idx
  on public.comments (target_kind, target_id, created_at);

-- ---------------------------------------------------------------------------
-- remixes (template/project remix attribution)
-- ---------------------------------------------------------------------------
create table if not exists public.remixes (
  id                 uuid primary key default gen_random_uuid(),
  original_id        text not null,
  original_author_id uuid references public.profiles (id) on delete set null,
  remixer_id         uuid not null references public.profiles (id) on delete cascade,
  new_project_id     uuid references public.projects (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists remixes_original_id_idx on public.remixes (original_id);

-- ---------------------------------------------------------------------------
-- analytics_events (product analytics per project; insert via edge fn)
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id         bigint generated always as identity primary key,
  project_id uuid references public.projects (id) on delete cascade,
  event      text not null,
  source     text,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_project_id_idx
  on public.analytics_events (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- telemetry_events (opt-in only; user insert/select own)
-- ---------------------------------------------------------------------------
create table if not exists public.telemetry_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  props      jsonb,
  session_id text,
  created_at timestamptz not null default now()
);
create index if not exists telemetry_events_user_id_idx
  on public.telemetry_events (user_id, created_at desc);
