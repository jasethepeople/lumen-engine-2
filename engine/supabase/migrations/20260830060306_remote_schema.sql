


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."accept_invitation"("invite_token" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."accept_invitation"("invite_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_bundle"("p_project_id_text" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.project_members
     where project_id = p_project_id_text::uuid
       and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."can_read_bundle"("p_project_id_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_invitations"() RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with updated as (
    update public.invitations
       set status = 'expired'
     where status = 'pending'
       and expires_at < now()
    returning id
  )
  select count(*)::int from updated;
$$;


ALTER FUNCTION "public"."expire_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_editor"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid()
                    and role in ('owner','editor'));
$$;


ALTER FUNCTION "public"."is_project_editor"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_member"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid());
$$;


ALTER FUNCTION "public"."is_project_member"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_owner"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.projects
                  where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p_project_id and user_id = auth.uid()
                    and role = 'owner');
$$;


ALTER FUNCTION "public"."is_project_owner"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select 'owner' from public.projects
      where id = p_project_id and owner_id = p_user_id),
    (select role from public.project_members
      where project_id = p_project_id and user_id = p_user_id)
  );
$$;


ALTER FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."projects_after_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."projects_after_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchases_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."purchases_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_scheduled_payouts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."settle_scheduled_payouts"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" bigint NOT NULL,
    "project_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "detail" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


ALTER TABLE "public"."activity_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."activity_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" bigint NOT NULL,
    "project_id" "uuid",
    "event" "text" NOT NULL,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


ALTER TABLE "public"."analytics_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."analytics_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."asset_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "ops" "text"[] NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "asset_jobs_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "asset_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."asset_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "manifest" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assets_kind_check" CHECK (("kind" = ANY (ARRAY['video'::"text", 'image'::"text"]))),
    CONSTRAINT "assets_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_kind" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "body" "text" NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comments_body_check" CHECK ((("length"("body") >= 1) AND ("length"("body") <= 1000))),
    CONSTRAINT "comments_target_kind_check" CHECK (("target_kind" = ANY (ARRAY['template'::"text", 'project'::"text"])))
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invitations_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text"]))),
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."merge_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "their_version_id" "uuid",
    "head_version_id" "uuid",
    "next_config" "jsonb",
    "fields_changed" "text"[],
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "merge_suggestions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."merge_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "period_start" timestamp with time zone NOT NULL,
    "period_end" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payouts_amount_cents_check" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "payouts_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'paid'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "handle" "text",
    "display_name" "text",
    "bio" "text",
    "avatar_color" "text",
    "links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_handle_check" CHECK (("handle" ~ '^[a-z0-9-]{3,24}$'::"text"))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "version_num" integer NOT NULL,
    "config" "jsonb",
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "template_kind" "text",
    "template_id" "text",
    "config" "jsonb",
    "shared" boolean DEFAULT false NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."publishes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "deployment_id" "text",
    "url" "text",
    "config_hash" "text",
    "bundle_path" "text",
    "status" "text" DEFAULT 'live'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "publishes_status_check" CHECK (("status" = ANY (ARRAY['live'::"text", 'rolled-back'::"text"])))
);


ALTER TABLE "public"."publishes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "template_id" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchases_amount_cents_check" CHECK (("amount_cents" >= 0))
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."remixes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "original_id" "text" NOT NULL,
    "original_author_id" "uuid",
    "remixer_id" "uuid" NOT NULL,
    "new_project_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."remixes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."revenue_ledger" (
    "id" bigint NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "creator_cents" integer NOT NULL,
    "platform_cents" integer NOT NULL,
    "settled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."revenue_ledger" OWNER TO "postgres";


ALTER TABLE "public"."revenue_ledger" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."revenue_ledger_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "user_id" "uuid" NOT NULL,
    "plan_id" "text" DEFAULT 'free'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_plan_id_check" CHECK (("plan_id" = ANY (ARRAY['free'::"text", 'pro'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'canceled'::"text", 'past_due'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telemetry_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "props" "jsonb",
    "session_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."telemetry_events" OWNER TO "postgres";


ALTER TABLE "public"."telemetry_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."telemetry_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."templates" (
    "id" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "template_kind" "text",
    "version" "text",
    "categories" "text"[],
    "tags" "text"[],
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "price_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    "entry_config" "jsonb",
    "thumbnail" "text",
    "engine_min_version" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "templates_price_cents_check" CHECK (("price_cents" >= 0)),
    CONSTRAINT "templates_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."templates" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_jobs"
    ADD CONSTRAINT "asset_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."merge_suggestions"
    ADD CONSTRAINT "merge_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."project_versions"
    ADD CONSTRAINT "project_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_versions"
    ADD CONSTRAINT "project_versions_project_id_version_num_key" UNIQUE ("project_id", "version_num");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."publishes"
    ADD CONSTRAINT "publishes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_user_id_template_id_key" UNIQUE ("user_id", "template_id");



ALTER TABLE ONLY "public"."remixes"
    ADD CONSTRAINT "remixes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."revenue_ledger"
    ADD CONSTRAINT "revenue_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."revenue_ledger"
    ADD CONSTRAINT "revenue_ledger_purchase_id_key" UNIQUE ("purchase_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."telemetry_events"
    ADD CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_pkey" PRIMARY KEY ("id");



CREATE INDEX "activity_log_project_id_idx" ON "public"."activity_log" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "analytics_events_project_id_idx" ON "public"."analytics_events" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "asset_jobs_asset_id_idx" ON "public"."asset_jobs" USING "btree" ("asset_id");



CREATE INDEX "asset_jobs_status_idx" ON "public"."asset_jobs" USING "btree" ("status") WHERE ("status" = 'queued'::"text");



CREATE INDEX "assets_owner_id_idx" ON "public"."assets" USING "btree" ("owner_id");



CREATE INDEX "assets_project_id_idx" ON "public"."assets" USING "btree" ("project_id");



CREATE INDEX "comments_target_idx" ON "public"."comments" USING "btree" ("target_kind", "target_id", "created_at");



CREATE INDEX "invitations_project_id_idx" ON "public"."invitations" USING "btree" ("project_id");



CREATE INDEX "merge_suggestions_project_id_idx" ON "public"."merge_suggestions" USING "btree" ("project_id");



CREATE INDEX "payouts_author_id_idx" ON "public"."payouts" USING "btree" ("author_id");



CREATE INDEX "payouts_status_idx" ON "public"."payouts" USING "btree" ("status") WHERE ("status" = 'scheduled'::"text");



CREATE INDEX "project_members_user_id_idx" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "project_versions_project_id_idx" ON "public"."project_versions" USING "btree" ("project_id", "version_num" DESC);



CREATE INDEX "projects_owner_id_idx" ON "public"."projects" USING "btree" ("owner_id");



CREATE INDEX "publishes_project_id_idx" ON "public"."publishes" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "purchases_template_id_idx" ON "public"."purchases" USING "btree" ("template_id");



CREATE INDEX "remixes_original_id_idx" ON "public"."remixes" USING "btree" ("original_id");



CREATE INDEX "revenue_ledger_author_id_idx" ON "public"."revenue_ledger" USING "btree" ("author_id", "settled");



CREATE INDEX "telemetry_events_user_id_idx" ON "public"."telemetry_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "templates_author_id_idx" ON "public"."templates" USING "btree" ("author_id");



CREATE OR REPLACE TRIGGER "asset_jobs_set_updated_at" BEFORE UPDATE ON "public"."asset_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "projects_after_update" AFTER UPDATE OF "config" ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."projects_after_update"();



CREATE OR REPLACE TRIGGER "projects_set_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "purchases_after_insert" AFTER INSERT ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."purchases_after_insert"();



CREATE OR REPLACE TRIGGER "subscriptions_set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "templates_set_updated_at" BEFORE UPDATE ON "public"."templates" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_jobs"
    ADD CONSTRAINT "asset_jobs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."merge_suggestions"
    ADD CONSTRAINT "merge_suggestions_head_version_id_fkey" FOREIGN KEY ("head_version_id") REFERENCES "public"."project_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."merge_suggestions"
    ADD CONSTRAINT "merge_suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."merge_suggestions"
    ADD CONSTRAINT "merge_suggestions_their_version_id_fkey" FOREIGN KEY ("their_version_id") REFERENCES "public"."project_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."merge_suggestions"
    ADD CONSTRAINT "merge_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_versions"
    ADD CONSTRAINT "project_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."publishes"
    ADD CONSTRAINT "publishes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."remixes"
    ADD CONSTRAINT "remixes_new_project_id_fkey" FOREIGN KEY ("new_project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."remixes"
    ADD CONSTRAINT "remixes_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."remixes"
    ADD CONSTRAINT "remixes_remixer_id_fkey" FOREIGN KEY ("remixer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."revenue_ledger"
    ADD CONSTRAINT "revenue_ledger_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."revenue_ledger"
    ADD CONSTRAINT "revenue_ledger_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."telemetry_events"
    ADD CONSTRAINT "telemetry_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_log_insert_editor" ON "public"."activity_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_project_editor"("project_id") AND ("actor_id" = "auth"."uid"())));



CREATE POLICY "activity_log_select_member" ON "public"."activity_log" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analytics_events_select_member" ON "public"."analytics_events" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."asset_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_jobs_insert_editor" ON "public"."asset_jobs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_jobs"."asset_id") AND "public"."is_project_editor"("a"."project_id")))));



CREATE POLICY "asset_jobs_select_member" ON "public"."asset_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_jobs"."asset_id") AND "public"."is_project_member"("a"."project_id")))));



ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assets_delete_owner" ON "public"."assets" FOR DELETE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_project_owner"("project_id")));



CREATE POLICY "assets_insert_editor" ON "public"."assets" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_project_editor"("project_id") AND ("owner_id" = "auth"."uid"())));



CREATE POLICY "assets_select_member" ON "public"."assets" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comments_delete_own" ON "public"."comments" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "comments_insert_authenticated" ON "public"."comments" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "comments_select_visible" ON "public"."comments" FOR SELECT TO "authenticated", "anon" USING (("deleted_at" IS NULL));



CREATE POLICY "comments_update_own" ON "public"."comments" FOR UPDATE TO "authenticated" USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_delete_owner" ON "public"."invitations" FOR DELETE TO "authenticated" USING ("public"."is_project_owner"("project_id"));



CREATE POLICY "invitations_insert_owner" ON "public"."invitations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_project_owner"("project_id"));



CREATE POLICY "invitations_select_owner" ON "public"."invitations" FOR SELECT TO "authenticated" USING ("public"."is_project_owner"("project_id"));



CREATE POLICY "invitations_update_owner" ON "public"."invitations" FOR UPDATE TO "authenticated" USING ("public"."is_project_owner"("project_id")) WITH CHECK ("public"."is_project_owner"("project_id"));



ALTER TABLE "public"."merge_suggestions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "merge_suggestions_insert_editor" ON "public"."merge_suggestions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_project_editor"("project_id") AND ("user_id" = "auth"."uid"())));



CREATE POLICY "merge_suggestions_select_member" ON "public"."merge_suggestions" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "merge_suggestions_update_owner" ON "public"."merge_suggestions" FOR UPDATE TO "authenticated" USING ("public"."is_project_editor"("project_id"));



ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payouts_select_own" ON "public"."payouts" FOR SELECT TO "authenticated" USING (("author_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_select_all" ON "public"."profiles" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_members_delete_owner" ON "public"."project_members" FOR DELETE TO "authenticated" USING (("public"."is_project_owner"("project_id") AND ("user_id" <> "auth"."uid"())));



CREATE POLICY "project_members_insert_owner_self" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("role" = 'owner'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "project_members_select_member" ON "public"."project_members" FOR SELECT TO "authenticated" USING (("public"."is_project_member"("project_id") OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."project_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_versions_insert_editor" ON "public"."project_versions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_project_editor"("project_id"));



CREATE POLICY "project_versions_select_member" ON "public"."project_versions" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete_owner" ON "public"."projects" FOR DELETE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_project_owner"("id")));



CREATE POLICY "projects_insert_authenticated" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "projects_select_member" ON "public"."projects" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_project_member"("id")));



CREATE POLICY "projects_update_editor" ON "public"."projects" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_project_editor"("id"))) WITH CHECK ((("owner_id" = "auth"."uid"()) OR "public"."is_project_editor"("id")));



ALTER TABLE "public"."publishes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "publishes_select_member" ON "public"."publishes" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchases_insert_self" ON "public"."purchases" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."templates" "t"
  WHERE (("t"."id" = "purchases"."template_id") AND ("t"."author_id" <> "auth"."uid"()))))));



CREATE POLICY "purchases_select_own" ON "public"."purchases" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."remixes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "remixes_insert_authenticated" ON "public"."remixes" FOR INSERT TO "authenticated" WITH CHECK (("remixer_id" = "auth"."uid"()));



CREATE POLICY "remixes_select_all" ON "public"."remixes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."revenue_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "revenue_ledger_select_own" ON "public"."revenue_ledger" FOR SELECT TO "authenticated" USING (("author_id" = "auth"."uid"()));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_select_own" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."telemetry_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "telemetry_events_insert_own" ON "public"."telemetry_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "telemetry_events_select_own" ON "public"."telemetry_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "templates_delete_author" ON "public"."templates" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "templates_insert_author" ON "public"."templates" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "templates_select_all" ON "public"."templates" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "templates_update_author" ON "public"."templates" FOR UPDATE TO "authenticated" USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."asset_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."comments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."merge_suggestions";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "public"."accept_invitation"("invite_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invitation"("invite_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_invitation"("invite_token" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."accept_invitation"("invite_token" "text") TO "anon";



REVOKE ALL ON FUNCTION "public"."can_read_bundle"("p_project_id_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_bundle"("p_project_id_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_bundle"("p_project_id_text" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_read_bundle"("p_project_id_text" "text") TO "anon";



REVOKE ALL ON FUNCTION "public"."expire_invitations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_invitations"() TO "service_role";
GRANT ALL ON FUNCTION "public"."expire_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_invitations"() TO "anon";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";



REVOKE ALL ON FUNCTION "public"."is_project_editor"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_editor"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_editor"("p_project_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_project_editor"("p_project_id" "uuid") TO "anon";



REVOKE ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid") TO "anon";



REVOKE ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_project_owner"("p_project_id" "uuid") TO "anon";



REVOKE ALL ON FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") TO "anon";



GRANT ALL ON FUNCTION "public"."projects_after_update"() TO "service_role";
GRANT ALL ON FUNCTION "public"."projects_after_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."projects_after_update"() TO "anon";



GRANT ALL ON FUNCTION "public"."purchases_after_insert"() TO "service_role";
GRANT ALL ON FUNCTION "public"."purchases_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchases_after_insert"() TO "anon";



REVOKE ALL ON FUNCTION "public"."settle_scheduled_payouts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_scheduled_payouts"() TO "service_role";
GRANT ALL ON FUNCTION "public"."settle_scheduled_payouts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."settle_scheduled_payouts"() TO "anon";
























GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."activity_log" TO "anon";
GRANT ALL ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."activity_log_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."activity_log_id_seq" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."analytics_events_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."analytics_events_id_seq" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."asset_jobs" TO "anon";
GRANT ALL ON TABLE "public"."asset_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_jobs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."merge_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."merge_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."merge_suggestions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_versions" TO "anon";
GRANT ALL ON TABLE "public"."project_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."project_versions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."publishes" TO "anon";
GRANT ALL ON TABLE "public"."publishes" TO "authenticated";
GRANT ALL ON TABLE "public"."publishes" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."remixes" TO "anon";
GRANT ALL ON TABLE "public"."remixes" TO "authenticated";
GRANT ALL ON TABLE "public"."remixes" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."revenue_ledger" TO "anon";
GRANT ALL ON TABLE "public"."revenue_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."revenue_ledger" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."revenue_ledger_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."revenue_ledger_id_seq" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."telemetry_events" TO "anon";
GRANT ALL ON TABLE "public"."telemetry_events" TO "authenticated";
GRANT ALL ON TABLE "public"."telemetry_events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."telemetry_events_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."telemetry_events_id_seq" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."templates" TO "anon";
GRANT ALL ON TABLE "public"."templates" TO "authenticated";
GRANT ALL ON TABLE "public"."templates" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,USAGE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,USAGE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

revoke delete on table "public"."activity_log" from "anon";

revoke insert on table "public"."activity_log" from "anon";

revoke update on table "public"."activity_log" from "anon";

revoke delete on table "public"."analytics_events" from "anon";

revoke insert on table "public"."analytics_events" from "anon";

revoke update on table "public"."analytics_events" from "anon";

revoke delete on table "public"."asset_jobs" from "anon";

revoke insert on table "public"."asset_jobs" from "anon";

revoke update on table "public"."asset_jobs" from "anon";

revoke delete on table "public"."assets" from "anon";

revoke insert on table "public"."assets" from "anon";

revoke update on table "public"."assets" from "anon";

revoke delete on table "public"."comments" from "anon";

revoke insert on table "public"."comments" from "anon";

revoke update on table "public"."comments" from "anon";

revoke delete on table "public"."invitations" from "anon";

revoke insert on table "public"."invitations" from "anon";

revoke update on table "public"."invitations" from "anon";

revoke delete on table "public"."merge_suggestions" from "anon";

revoke insert on table "public"."merge_suggestions" from "anon";

revoke update on table "public"."merge_suggestions" from "anon";

revoke delete on table "public"."payouts" from "anon";

revoke insert on table "public"."payouts" from "anon";

revoke update on table "public"."payouts" from "anon";

revoke delete on table "public"."profiles" from "anon";

revoke insert on table "public"."profiles" from "anon";

revoke update on table "public"."profiles" from "anon";

revoke delete on table "public"."project_members" from "anon";

revoke insert on table "public"."project_members" from "anon";

revoke update on table "public"."project_members" from "anon";

revoke delete on table "public"."project_versions" from "anon";

revoke insert on table "public"."project_versions" from "anon";

revoke update on table "public"."project_versions" from "anon";

revoke delete on table "public"."projects" from "anon";

revoke insert on table "public"."projects" from "anon";

revoke update on table "public"."projects" from "anon";

revoke delete on table "public"."publishes" from "anon";

revoke insert on table "public"."publishes" from "anon";

revoke update on table "public"."publishes" from "anon";

revoke delete on table "public"."purchases" from "anon";

revoke insert on table "public"."purchases" from "anon";

revoke update on table "public"."purchases" from "anon";

revoke delete on table "public"."remixes" from "anon";

revoke insert on table "public"."remixes" from "anon";

revoke update on table "public"."remixes" from "anon";

revoke delete on table "public"."revenue_ledger" from "anon";

revoke insert on table "public"."revenue_ledger" from "anon";

revoke update on table "public"."revenue_ledger" from "anon";

revoke delete on table "public"."subscriptions" from "anon";

revoke insert on table "public"."subscriptions" from "anon";

revoke update on table "public"."subscriptions" from "anon";

revoke delete on table "public"."telemetry_events" from "anon";

revoke insert on table "public"."telemetry_events" from "anon";

revoke update on table "public"."telemetry_events" from "anon";

revoke delete on table "public"."templates" from "anon";

revoke insert on table "public"."templates" from "anon";

revoke update on table "public"."templates" from "anon";


  create policy "assets_storage_delete_owner"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "assets_storage_insert_owner"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "assets_storage_read_member"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'assets'::text) AND public.is_project_member(((storage.foldername(name))[2])::uuid)));



  create policy "assets_storage_read_owner"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "assets_storage_update_owner"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
with check (((bucket_id = 'assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "bundles_storage_read_member"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'bundles'::text) AND public.can_read_bundle((storage.foldername(name))[1])));



  create policy "thumbnails_storage_delete_own"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'thumbnails'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "thumbnails_storage_insert_own"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'thumbnails'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "thumbnails_storage_read_public"
  on "storage"."objects"
  as permissive
  for select
  to authenticated, anon
using ((bucket_id = 'thumbnails'::text));



  create policy "thumbnails_storage_update_own"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'thumbnails'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
with check (((bucket_id = 'thumbnails'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



