-- 0012: projects policies — put owner_id = auth.uid() directly in the policy
-- expressions. The helper-function-only form fails for INSERT ... RETURNING
-- (PostgREST return=representation), blocking owner project creation.

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
