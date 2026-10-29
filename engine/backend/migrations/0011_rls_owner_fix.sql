-- 0011: RLS helper fix — the project owner (projects.owner_id) is always an
-- implicit 'owner' member, even without a project_members row. Phase-21
-- helpers only consulted project_members, so owners could not SELECT their
-- own projects (and PostgREST inserts with return=representation failed).

create or replace function public.project_role(p_project_id uuid, p_user_id uuid)
returns text language sql security definer set search_path = public stable as $$
  select coalesce(
    (select 'owner' from public.projects
      where id = p_project_id and owner_id = p_user_id),
    (select role from public.project_members
      where project_id = p_project_id and user_id = p_user_id)
  );
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid());
$$;

create or replace function public.is_project_editor(p_project_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid()
                    and role in ('owner','editor'));
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid()
                    and role = 'owner');
$$;
