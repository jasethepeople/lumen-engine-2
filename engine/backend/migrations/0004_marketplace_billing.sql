-- 0004_marketplace_billing.sql
-- Lumen Engine Phase 21 — marketplace and billing:
--   templates, purchases, payouts, revenue_ledger, subscriptions
-- Idempotent: create table if not exists. RLS is enabled in 0007_rls.sql.

-- ---------------------------------------------------------------------------
-- templates (marketplace listings; id is a text slug)
-- ---------------------------------------------------------------------------
create table if not exists public.templates (
  id                 text primary key,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  name               text not null,
  description        text,
  template_kind      text,
  version            text,
  categories         text[],
  tags               text[],
  tier               text not null default 'free' check (tier in ('free', 'paid')),
  price_cents        int not null default 0 check (price_cents >= 0),
  currency           text not null default 'usd',
  entry_config       jsonb,
  thumbnail          text,
  engine_min_version text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists templates_author_id_idx on public.templates (author_id);

-- ---------------------------------------------------------------------------
-- purchases (one purchase per user per template)
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  template_id  text not null references public.templates (id) on delete restrict,
  amount_cents int not null check (amount_cents >= 0),
  created_at   timestamptz not null default now(),
  unique (user_id, template_id)
);
create index if not exists purchases_template_id_idx
  on public.purchases (template_id);

-- ---------------------------------------------------------------------------
-- payouts (author settlements; 70/30 split computed in revenue_ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.payouts (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles (id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'paid', 'failed')),
  period_start timestamptz not null,
  period_end   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists payouts_author_id_idx on public.payouts (author_id);
create index if not exists payouts_status_idx on public.payouts (status)
  where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- revenue_ledger (per-purchase 70/30 split; written by purchases_after_insert)
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_ledger (
  id            bigint generated always as identity primary key,
  purchase_id   uuid not null references public.purchases (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  amount_cents  int not null,
  creator_cents int not null,
  platform_cents int not null,
  settled       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (purchase_id)
);
create index if not exists revenue_ledger_author_id_idx
  on public.revenue_ledger (author_id, settled);

-- ---------------------------------------------------------------------------
-- subscriptions (one row per user; plan: free | pro)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  plan_id             text not null default 'free' check (plan_id in ('free', 'pro')),
  status              text not null default 'active'
                      check (status in ('active', 'canceled', 'past_due')),
  current_period_end  timestamptz,
  updated_at          timestamptz not null default now()
);
