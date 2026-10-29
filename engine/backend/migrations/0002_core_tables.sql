-- 0002_core_tables.sql
-- Lumen Engine Phase 21 — core tables:
--   profiles, projects, project_versions, project_members,
--   invitations, merge_suggestions, activity_log
-- Idempotent: create table if not exists. RLS is enabled in 0007_rls.sql.

-- ---------------------------------------------------------------------------
-- profiles: id uuid pk references auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       text unique check (handle ~ '^[a-z0-9-]{3,24}$'),
  display_name text,
  bio          text,
  avatar_color text,
  links        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  template_kind  text,
  template_id    text,
  config         jsonb,
  shared         boolean not null default false,
  schema_version int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists projects_owner_id_idx on public.projects (owner_id);

-- ---------------------------------------------------------------------------
-- project_versions (autosave history, see projects_after_update trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.project_versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  version_num int not null,
  config      jsonb,
  label       text,
  created_at  timestamptz not null default now(),
  unique (project_id, version_num)
);
create index if not exists project_versions_project_id_idx
  on public.project_versions (project_id, version_num desc);

-- ---------------------------------------------------------------------------
-- project_members (role: owner | editor | viewer)
-- ---------------------------------------------------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_id_idx
  on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  token      text not null unique,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists invitations_project_id_idx
  on public.invitations (project_id);

-- ---------------------------------------------------------------------------
-- merge_suggestions (collaborative merge proposals)
-- ---------------------------------------------------------------------------
create table if not exists public.merge_suggestions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  their_version_id uuid references public.project_versions (id) on delete set null,
  head_version_id uuid references public.project_versions (id) on delete set null,
  next_config     jsonb,
  fields_changed  text[],
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'rejected')),
  created_at      timestamptz not null default now()
);
create index if not exists merge_suggestions_project_id_idx
  on public.merge_suggestions (project_id);

-- ---------------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------------
create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_project_id_idx
  on public.activity_log (project_id, created_at desc);
