-- 0006_functions_triggers.sql
-- Lumen Engine Phase 21 — SQL functions and triggers:
--   handle_updated_at(), projects_after_update, purchases_after_insert,
--   accept_invitation(invite_token), expire_invitations(), settle_scheduled_payouts()
-- Idempotent: create or replace function / drop trigger if exists before create.

-- ---------------------------------------------------------------------------
-- handle_updated_at(): generic updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.handle_updated_at();

drop trigger if exists templates_set_updated_at on public.templates;
create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.handle_updated_at();

drop trigger if exists asset_jobs_set_updated_at on public.asset_jobs;
create trigger asset_jobs_set_updated_at
  before update on public.asset_jobs
  for each row execute function public.handle_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- projects_after_update: autosave versioning.
-- On config change, insert a project_versions row with the next version_num
-- and prune history beyond the newest 50 versions.
-- ---------------------------------------------------------------------------
create or replace function public.projects_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num int;
begin
  -- Only version when the config actually changed.
  if new.config is not distinct from old.config then
    return new;
  end if;

  select coalesce(max(version_num), 0) + 1
    into next_num
    from public.project_versions
   where project_id = new.id;

  insert into public.project_versions (project_id, version_num, config, label)
  values (new.id, next_num, new.config, 'autosave')
  on conflict (project_id, version_num) do nothing;

  -- Prune: keep only the 50 most recent versions.
  delete from public.project_versions
   where project_id = new.id
     and version_num <= (
       select coalesce(max(version_num) - 50, 0)
         from public.project_versions
        where project_id = new.id
     );

  return new;
end;
$$;

drop trigger if exists projects_after_update on public.projects;
create trigger projects_after_update
  after update of config on public.projects
  for each row execute function public.projects_after_update();

-- ---------------------------------------------------------------------------
-- purchases_after_insert: write the revenue_ledger split row.
-- creator = round(0.7 * amount), platform = remainder (70/30 split).
-- ---------------------------------------------------------------------------
create or replace function public.purchases_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_creator   int;
begin
  select author_id into v_author_id
    from public.templates
   where id = new.template_id;

  if v_author_id is null then
    raise exception 'template % not found for purchase %', new.template_id, new.id;
  end if;

  v_creator := round(0.7 * new.amount_cents)::int;

  insert into public.revenue_ledger
    (purchase_id, author_id, amount_cents, creator_cents, platform_cents)
  values
    (new.id, v_author_id, new.amount_cents, v_creator, new.amount_cents - v_creator)
  on conflict (purchase_id) do nothing;

  return new;
end;
$$;

drop trigger if exists purchases_after_insert on public.purchases;
create trigger purchases_after_insert
  after insert on public.purchases
  for each row execute function public.purchases_after_insert();

-- ---------------------------------------------------------------------------
-- accept_invitation(invite_token text): security-definer RPC.
-- Validates the invitation is pending and unexpired, adds the caller to
-- project_members, and marks the invitation accepted.
-- ---------------------------------------------------------------------------
create or replace function public.accept_invitation(invite_token text)
returns uuid  -- returns the project_id joined
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv  public.invitations%rowtype;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_inv
    from public.invitations
   where token = invite_token;

  if not found then
    raise exception 'invitation not found';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation is not pending (status: %)', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.invitations
       set status = 'expired'
     where id = v_inv.id;
    raise exception 'invitation has expired';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_inv.project_id, v_uid, v_inv.role)
  on conflict (project_id, user_id)
  do update set role = excluded.role;

  update public.invitations
     set status = 'accepted'
   where id = v_inv.id;

  return v_inv.project_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- expire_invitations(): hourly cron target — mark stale pending invites.
-- ---------------------------------------------------------------------------
create or replace function public.expire_invitations()
returns integer
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.invitations
       set status = 'expired'
     where status = 'pending'
       and expires_at < now()
    returning id
  )
  select count(*)::int from updated;
$$;

revoke all on function public.expire_invitations() from public;

-- ---------------------------------------------------------------------------
-- settle_scheduled_payouts(): daily cron target (skeleton).
-- Marks unsettled revenue_ledger rows as settled for scheduled payouts whose
-- period has ended and sets them paid. Real money movement happens in the
-- `payouts` edge function; this SQL path is the default cron target.
-- ---------------------------------------------------------------------------
create or replace function public.settle_scheduled_payouts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  with due as (
    update public.payouts
       set status = 'paid'
     where status = 'scheduled'
       and period_end < now()
    returning id, author_id, period_start, period_end
  ), settled as (
    update public.revenue_ledger rl
       set settled = true
      from due d
     where rl.author_id = d.author_id
       and rl.settled = false
       and rl.created_at >= d.period_start
       and rl.created_at <  d.period_end
    returning rl.id
  )
  select count(*)::int into n from settled;

  return n;
end;
$$;

revoke all on function public.settle_scheduled_payouts() from public;
