-- 0007_rls.sql
-- Lumen Engine Phase 21 — row level security.
-- Enables RLS on every table and installs the full policy set per SCHEMA.md.
-- Idempotent: drop policy if exists before create policy.

-- ---------------------------------------------------------------------------
-- Security-definer helpers (avoid recursive RLS on project_members).
-- ---------------------------------------------------------------------------
create or replace function public.project_role(p_project_id uuid, p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select 'owner' from public.projects
      where id = p_project_id and owner_id = p_user_id),
    (select role from public.project_members
      where project_id = p_project_id and user_id = p_user_id)
  );
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid());
$$;

create or replace function public.is_project_editor(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid()
                    and role in ('owner', 'editor'));
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid()
                    and role = 'owner');
$$;

revoke all on function public.project_role(uuid, uuid) from public;
revoke all on function public.is_project_member(uuid) from public;
revoke all on function public.is_project_editor(uuid) from public;
revoke all on function public.is_project_owner(uuid) from public;
grant execute on function public.project_role(uuid, uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.is_project_editor(uuid) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table.
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_versions  enable row level security;
alter table public.project_members   enable row level security;
alter table public.invitations       enable row level security;
alter table public.merge_suggestions enable row level security;
alter table public.activity_log      enable row level security;
alter table public.assets            enable row level security;
alter table public.asset_jobs        enable row level security;
alter table public.publishes         enable row level security;
alter table public.templates         enable row level security;
alter table public.purchases         enable row level security;
alter table public.payouts           enable row level security;
alter table public.revenue_ledger    enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.comments          enable row level security;
alter table public.remixes           enable row level security;
alter table public.analytics_events  enable row level security;
alter table public.telemetry_events  enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: read all; update own.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated, anon
  using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects: owner full; members per role (viewer select; editor select/update
-- config; owner all + delete). Membership rows are created at project creation
-- (owner role) and via accept_invitation().
-- ---------------------------------------------------------------------------
drop policy if exists projects_select_member on public.projects;
create policy projects_select_member on public.projects
  for select to authenticated
  using (owner_id = auth.uid() or public.is_project_member(id));

drop policy if exists projects_insert_authenticated on public.projects;
create policy projects_insert_authenticated on public.projects
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists projects_update_editor on public.projects;
create policy projects_update_editor on public.projects
  for update to authenticated
  using (owner_id = auth.uid() or public.is_project_editor(id))
  with check (owner_id = auth.uid() or public.is_project_editor(id));

drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_project_owner(id));

-- ---------------------------------------------------------------------------
-- project_versions: members read; editor+ insert.
-- (Autosave inserts run inside the security-definer trigger, bypassing RLS.)
-- ---------------------------------------------------------------------------
drop policy if exists project_versions_select_member on public.project_versions;
create policy project_versions_select_member on public.project_versions
  for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists project_versions_insert_editor on public.project_versions;
create policy project_versions_insert_editor on public.project_versions
  for insert to authenticated
  with check (public.is_project_editor(project_id));

-- ---------------------------------------------------------------------------
-- project_members: members read own project's roster; inserts happen via
-- project creation (owner's own row) or the accept_invitation() RPC.
-- Owners may remove members (not themselves).
-- ---------------------------------------------------------------------------
drop policy if exists project_members_select_member on public.project_members;
create policy project_members_select_member on public.project_members
  for select to authenticated
  using (public.is_project_member(project_id) or user_id = auth.uid());

drop policy if exists project_members_insert_owner_self on public.project_members;
create policy project_members_insert_owner_self on public.project_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from public.projects p
       where p.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists project_members_delete_owner on public.project_members;
create policy project_members_delete_owner on public.project_members
  for delete to authenticated
  using (public.is_project_owner(project_id) and user_id <> auth.uid());

-- ---------------------------------------------------------------------------
-- invitations: project owners manage; accepting goes through
-- accept_invitation(token) (security definer).
-- ---------------------------------------------------------------------------
drop policy if exists invitations_select_owner on public.invitations;
create policy invitations_select_owner on public.invitations
  for select to authenticated
  using (public.is_project_owner(project_id));

drop policy if exists invitations_insert_owner on public.invitations;
create policy invitations_insert_owner on public.invitations
  for insert to authenticated
  with check (public.is_project_owner(project_id));

drop policy if exists invitations_update_owner on public.invitations;
create policy invitations_update_owner on public.invitations
  for update to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

drop policy if exists invitations_delete_owner on public.invitations;
create policy invitations_delete_owner on public.invitations
  for delete to authenticated
  using (public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- merge_suggestions: members read; editor+ insert.
-- ---------------------------------------------------------------------------
drop policy if exists merge_suggestions_select_member on public.merge_suggestions;
create policy merge_suggestions_select_member on public.merge_suggestions
  for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists merge_suggestions_insert_editor on public.merge_suggestions;
create policy merge_suggestions_insert_editor on public.merge_suggestions
  for insert to authenticated
  with check (public.is_project_editor(project_id) and user_id = auth.uid());

drop policy if exists merge_suggestions_update_owner on public.merge_suggestions;
create policy merge_suggestions_update_owner on public.merge_suggestions
  for update to authenticated
  using (public.is_project_editor(project_id));

-- ---------------------------------------------------------------------------
-- activity_log: members read; editor+ insert.
-- ---------------------------------------------------------------------------
drop policy if exists activity_log_select_member on public.activity_log;
create policy activity_log_select_member on public.activity_log
  for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists activity_log_insert_editor on public.activity_log;
create policy activity_log_insert_editor on public.activity_log
  for insert to authenticated
  with check (public.is_project_editor(project_id) and actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- assets: project members read; editor+ insert; worker uses service role.
-- ---------------------------------------------------------------------------
drop policy if exists assets_select_member on public.assets;
create policy assets_select_member on public.assets
  for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists assets_insert_editor on public.assets;
create policy assets_insert_editor on public.assets
  for insert to authenticated
  with check (public.is_project_editor(project_id) and owner_id = auth.uid());

drop policy if exists assets_delete_owner on public.assets;
create policy assets_delete_owner on public.assets
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- asset_jobs: project members read; editor+ insert; worker uses service role.
-- ---------------------------------------------------------------------------
drop policy if exists asset_jobs_select_member on public.asset_jobs;
create policy asset_jobs_select_member on public.asset_jobs
  for select to authenticated
  using (exists (
    select 1 from public.assets a
     where a.id = asset_id
       and public.is_project_member(a.project_id)
  ));

drop policy if exists asset_jobs_insert_editor on public.asset_jobs;
create policy asset_jobs_insert_editor on public.asset_jobs
  for insert to authenticated
  with check (exists (
    select 1 from public.assets a
     where a.id = asset_id
       and public.is_project_editor(a.project_id)
  ));

-- ---------------------------------------------------------------------------
-- publishes: members read; insert via edge fn (service role) — no client
-- insert/update/delete policies.
-- ---------------------------------------------------------------------------
drop policy if exists publishes_select_member on public.publishes;
create policy publishes_select_member on public.publishes
  for select to authenticated
  using (public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- templates: read all; author insert/update own.
-- ---------------------------------------------------------------------------
drop policy if exists templates_select_all on public.templates;
create policy templates_select_all on public.templates
  for select to authenticated, anon
  using (true);

drop policy if exists templates_insert_author on public.templates;
create policy templates_insert_author on public.templates
  for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists templates_update_author on public.templates;
create policy templates_update_author on public.templates
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists templates_delete_author on public.templates;
create policy templates_delete_author on public.templates
  for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- purchases: user reads own; authenticated self-insert (mock checkout);
-- template must be purchasable and not authored by the buyer.
-- ---------------------------------------------------------------------------
drop policy if exists purchases_select_own on public.purchases;
create policy purchases_select_own on public.purchases
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists purchases_insert_self on public.purchases;
create policy purchases_insert_self on public.purchases
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.templates t
       where t.id = template_id
         and t.author_id <> auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- payouts: author reads own rows; writes service-role only (no client
-- write policies).
-- ---------------------------------------------------------------------------
drop policy if exists payouts_select_own on public.payouts;
create policy payouts_select_own on public.payouts
  for select to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- revenue_ledger: author reads own rows; writes service-role only / trigger.
-- ---------------------------------------------------------------------------
drop policy if exists revenue_ledger_select_own on public.revenue_ledger;
create policy revenue_ledger_select_own on public.revenue_ledger
  for select to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- subscriptions: user reads own; writes service-role only.
-- ---------------------------------------------------------------------------
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- comments: read all non-deleted; insert authenticated; update/delete own.
-- ---------------------------------------------------------------------------
drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible on public.comments
  for select to authenticated, anon
  using (deleted_at is null);

drop policy if exists comments_insert_authenticated on public.comments;
create policy comments_insert_authenticated on public.comments
  for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments
  for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- remixes: read all; insert authenticated (remixer_id = uid()).
-- ---------------------------------------------------------------------------
drop policy if exists remixes_select_all on public.remixes;
create policy remixes_select_all on public.remixes
  for select to authenticated, anon
  using (true);

drop policy if exists remixes_insert_authenticated on public.remixes;
create policy remixes_insert_authenticated on public.remixes
  for insert to authenticated
  with check (remixer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- analytics_events: members read project rows; insert via edge fn.
-- ---------------------------------------------------------------------------
drop policy if exists analytics_events_select_member on public.analytics_events;
create policy analytics_events_select_member on public.analytics_events
  for select to authenticated
  using (public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- telemetry_events: user insert/select own only (opt-in).
-- ---------------------------------------------------------------------------
drop policy if exists telemetry_events_select_own on public.telemetry_events;
create policy telemetry_events_select_own on public.telemetry_events
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists telemetry_events_insert_own on public.telemetry_events;
create policy telemetry_events_insert_own on public.telemetry_events
  for insert to authenticated
  with check (user_id = auth.uid());
