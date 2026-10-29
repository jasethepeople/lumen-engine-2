-- 0008_storage.sql
-- Lumen Engine Phase 21 — storage buckets and storage.objects policies.
-- Buckets: assets (private), bundles (private), thumbnails (public read).
-- Idempotent: insert ... on conflict do nothing / drop policy if exists.

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('assets', 'assets', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('bundles', 'bundles', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Helper: read bundles by project membership.
-- Bundle paths are `{project_id}/{publish_id}/...`.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_bundle(p_project_id_text text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_members
     where project_id = p_project_id_text::uuid
       and user_id = auth.uid()
  );
$$;

revoke all on function public.can_read_bundle(text) from public;
grant execute on function public.can_read_bundle(text) to authenticated;

-- ---------------------------------------------------------------------------
-- assets bucket: private, owner-path read/write.
-- Path layout: {owner_id}/{project_id}/{asset_id}/...
-- ---------------------------------------------------------------------------
drop policy if exists assets_storage_read_owner on storage.objects;
create policy assets_storage_read_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists assets_storage_read_member on storage.objects;
create policy assets_storage_read_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'assets'
    and public.is_project_member(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists assets_storage_insert_owner on storage.objects;
create policy assets_storage_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists assets_storage_update_owner on storage.objects;
create policy assets_storage_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists assets_storage_delete_owner on storage.objects;
create policy assets_storage_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- bundles bucket: private; read by project members via can_read_bundle();
-- writes come from the publish-pipeline edge fn (service role).
-- Path layout: {project_id}/{publish_id}/...
-- ---------------------------------------------------------------------------
drop policy if exists bundles_storage_read_member on storage.objects;
create policy bundles_storage_read_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bundles'
    and public.can_read_bundle((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- thumbnails bucket: public read (bucket is public); authenticated users
-- upload/update/delete within their own top-level path ({owner_id}/...).
-- ---------------------------------------------------------------------------
drop policy if exists thumbnails_storage_read_public on storage.objects;
create policy thumbnails_storage_read_public on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'thumbnails');

drop policy if exists thumbnails_storage_insert_own on storage.objects;
create policy thumbnails_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists thumbnails_storage_update_own on storage.objects;
create policy thumbnails_storage_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists thumbnails_storage_delete_own on storage.objects;
create policy thumbnails_storage_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
