# Lumen Engine — Phases 8–13 Staged Pipeline

Constraints: additive/non-breaking; real seams only (`@lumen/app-runtime` createLumenApp, `@lumen/cli` lumen-media, BootOptions.reducedMotion, createExtendedRegistry); no external network calls (mock billing/Vercel); local-only telemetry; LUMEN_TSCJS-pinned tsc 5.x; commit early/often in worktrees.

## Wave 1 — Phase 8 foundations (parallel)
- A: `app/projects` — project CRUD, autosave + versioning (localStorage/FS adapter seam), branch `agent/phase8-projects`
- B: `app/settings` — user settings: reduced-motion default, theme presets, device-class override, branch `agent/phase8-settings`

## Wave 2 — Phase 9 monetization
- `app/billing` (mock billing, free/pro tiers), `app/entitlements` (feature/template/export gating), `app/telemetry` (local-only)

## Wave 3 — Phase 10 marketplace
- `app/marketplace` + `app/templates`: registry metadata/categories/tags/thumbnails, browser UI, detail view, install/update, search

## Wave 4 — Phase 11 onboarding
- `app/onboarding`: wizard (template → hero media → chapters → theme → preview), tooltips, first-publish walkthrough, checklists

## Wave 5 — Phase 12 hosted asset pipeline
- `app/assets` + cli/runtime: upload UI, optimization queue, hybrid manifest (GOP-1 MP4 + frame stacks via lumen-media), device-class detection, preview UI

## Wave 6 — Phase 13 publish-to-Vercel
- `app/publish`: SceneIR→static bundle, mock Vercel API, publish history, rollback

## Stage gate (every wave, before next)
1. `scripts/build-all.sh` clean
2. per-package tests green
3. `tests/e2e` 8/8
4. examples budgets PASSED ×3
5. working tree clean, branches merged to master

---

# Phases 14–20 Staged Pipeline

Same constraints: additive/non-breaking, real seams only, mock-only external services, local-only data, LUMEN_TSCJS tsc 5.x, commit early/often.

## Wave A — parallel packages (agents dispatched together, isolated worktrees)
- Phase 14 `agent/phase14-collab`: app/collaboration (shared projects, presence, LWW+merge suggestions, roles, mock invitations, local activity log); additive additions to app/projects only as new files.
- Phase 15 `agent/phase15-monetization`: paid templates (price metadata, gating, mock purchase), creator templates (upload/metadata editor/preview generator), mock revenue share. New files in app/marketplace|billing|entitlements.
- Phase 16 `agent/phase16-ai`: app/ai — provider seam + local heuristic/mock generators (SceneIR from description, motion/chapter/camera suggestions, asset tagging, template recommendations); all outputs parseConfig-validated.
- Phase 17 `agent/phase17-designer`: app/designer — timeline editor model (keyframes/easing/segments/camera tracks), motion graph data, frame-step scrub model.
- Phase 18 `agent/phase18-dashboard`: app/dashboard — hosted dashboard model (projects, publish history, rollback via @lumen/app-publish, local-only analytics), preview-before-publish, mock share links.
- Phase 19 `agent/phase19-community`: app/community — creator profiles, template/project showcase, remix flow, local-only comments.

## Wave B — Builder UI integration (single agent, after Wave A merges)
Tabs/panels for collaboration, marketplace purchases/creator upload, AI authoring assistant, motion designer, dashboard, community.

## Wave C — Phase 20 consolidation doc (no code)
docs/analysis/lumen-engine-evolution-v2.0.md + v2.0 readiness verdict.

## Stage gate (each wave): build-all OK; app tests + e2e green; example budgets ×3; clean tree.

---

# Phase 21 — Supabase Backend (free tier)
Schema contract: backend/SCHEMA.md (single source of truth for table/column names).

## Wave A (parallel)
- `agent/phase21-migrations`: backend/migrations/*.sql — tables, RLS, triggers, storage buckets, cron per SCHEMA.md.
- `agent/phase21-functions`: backend/functions/{publish-pipeline,asset-pipeline,payouts}/ — Deno edge functions per SCHEMA.md.
- `agent/phase21-client`: backend/supabase/ — typed TS client bindings per domain, interface-based with offline fallback to existing app/* memory adapters.

## Wave B: integration docs + validation (build-all, e2e, SQL lint/parse check).

---

# Phase 22 — SaaS Deployment (Supabase + Vercel)
Environment note: sandbox has no supabase/vercel CLIs, credentials, or network — deliver full automation + validation harness + offline smoke test; provisioning is one manual step for the user.

## Wave A (parallel)
- `agent/phase22-deploy`: backend/deploy/ automation (deploy-supabase.sh, secrets, validate-backend harness), vercel.json + frontend deploy script, .env templates, DEPLOYMENT.md runbook mapping every requirement to a command.
- `agent/phase22-wiring`: Builder hosted-backend wiring (createBackend env auto-select in services, backend status panel) + tests/saas-smoke/ offline end-to-end SaaS flow test.

## Gate: build-all, all tests, e2e, budgets, website version refresh.
