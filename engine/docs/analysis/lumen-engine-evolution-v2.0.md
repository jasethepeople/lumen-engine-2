# Lumen Engine — Evolution v2.0 Consolidation

*Phase 20 consolidation of the full v1.0 → v1.1 → v2.0 arc. Sources:
`docs/analysis/phase1-architectural-analysis.md` (W1–W17),
`phase2-proposed-improvements.md`, `phase3-implementation-plans.md`,
`phase5-validation-report.md`, `lumen-engine-evolution-v2.md` (v1.1
consolidation), `docs/consolidated-architecture.md`,
`docs/consolidated-agents.md`, `docs/stabilization-report.md`, `plan.md`
(phases 8–19 pipeline), and the `contracts/`, `packages/`, `app/` sources
themselves. Summaries only — no code dumps. Documentation change; zero code
changes in this phase.*

---

## 1. Executive summary

- **v1.0 (founding).** An 11-package engine monorepo behind frozen contracts:
  config → template `compose()` → `ComposedScene` → codegen lowers to SceneIR
  v1 (`SCENE_IR_VERSION = 1`, `contracts/src/ir.ts`) → runtime validates and
  boots a kernel-driven frame loop (interaction → playheads → scene evaluate →
  draw calls → renderer → adaptive quality). Renderer-agnostic draw list,
  capability→backend selection (webgpu → webgl2 → canvas2d → dom), EMA/
  hysteresis quality ladder, throttled video scrubber.
- **v0.2 stabilization** hardened operations (scrub guards, boot failure
  cleanup, WebGL context loss, import maps/vendored runtimes, iOS fixes) with
  no architectural change; 214 package tests + 8 e2e green.
- **Refactor C1–C9** squared the seams (SceneIR ownership in contracts, theme
  helper consolidation, frame-adapter relocation, naming alignment) with zero
  behavior change.
- **v1.1 (phases 1–5).** A principal-engineer audit (W1–W17) drove 14 landed
  additive plans + 3 plan-only deferrals (P3, P6, P16). SceneIR stayed v1 with
  additive optional fields only; Phase 5 validated 331 package tests + 8 e2e,
  208 root exports intact, SceneIR v1 docs unchanged.
- **v2.0 (phases 6–19).** The engine became a *platform*: an app layer of 17
  `app/*` packages (builder, projects, settings, telemetry, billing,
  entitlements, marketplace incl. monetization + creator pipeline, assets,
  publish, onboarding, collaboration, ai, designer, dashboard, community) on
  top of the engine via real seams only (`createLumenApp`, `lumen-media`,
  `createExtendedRegistry`, `BootOptions.reducedMotion`), plus a React Builder
  UI integrating all of it.
- **Everything external is deliberately mocked/local-only** (billing, Vercel,
  invitations, share links, AI provider default, analytics) — the seams are
  real, the services are swappable.
- **Compatibility never broke:** SceneIR v1 still the wire version; all app
  packages are additive, zero-dep-light, Node-importable, framework-free cores.
- **Verdict:** v2.0 READY — the platform is validated at every stage gate
  (build-all clean, per-package tests green, e2e 8/8, example budgets ×3), with
  a short, explicit deferred list (P3, P6, P16, boot-level DOM tests, real
  backends for mocks).

---

## 2. Subsystem maps

### 2.1 Engine packages (`packages/` + `contracts/`)

| Package | Responsibility | Key exports | Phase introduced |
|---|---|---|---|
| `@lumen/contracts` (`contracts/src/`) | Frozen cross-module types; owns `SceneIR` | `SceneIR`, `IRNode`, `IRTrack`, `IRAssetRef`, `SCENE_IR_VERSION = 1` | v1.0 |
| `@lumen/config` | `parseConfig`: migrate → validate → defaults for `EngineConfig` (schema v3) | `parseConfig` | v1.0 |
| `@lumen/templates` | `TemplateDescriptor`s; theme helpers; default + extended registries | `createDefaultRegistry`, `createExtendedRegistry` (v1.1 era) | v1.0 |
| `@lumen/codegen` | SceneIR lowering, 4 emit targets, hydration manifest, poster SSR fallback | `lowerToIR`, `generate`, `ssrSkeleton` param | v1.0 (P8/P17 fields v1.1) |
| `@lumen/build` | Phased build pipeline, content hashing, gzip budgets, deploy manifest | `runBuild` (pipeline), `BudgetReport` | v1.0 |
| `@lumen/kernel` | Lifecycle state machine, typed event bus, rAF scheduler (16 ms), capability detection, plugins | `createKernel`, `start()` (`boot()` deprecated alias) | v1.0 |
| `@lumen/scene` | Pure DOM-free scene graph, dirty world transforms, timeline evaluation | `createSceneRuntime`, `evaluate` | v1.0 |
| `@lumen/rendering` | Renderer backends + selection, adaptive quality, frame adapter | `IRenderer` impls (dom/canvas2d/webgl/webgpu stub), `drawCallsFromWorldState` (`src/frame-adapter.ts`) | v1.0 |
| `@lumen/assets` | Manifest handling, priority preload, two-tier cache, capability-aware variant selection | `AssetManager`, `pickVariant` (P7) | v1.0 |
| `@lumen/interaction` | Input normalization, gestures, virtual scroller, driver map, motion policy seam | drivers (time/scroll/gesture), `DriverMap` | v1.0 |
| `@lumen/runtime` | Browser boot orchestration, hydration, IR parsing, scrubber, motion policy, version-skew handling | `bootEngine`, `hydrateIslands`, `VersionSkewError` (P8), `createMotionPolicy` (P1) | v1.0 |

### 2.2 Platform app layer (`app/*`)

| Package | Responsibility | Key exports | Phase introduced |
|---|---|---|---|
| `app/runtime` (`@lumen/app-runtime`) | App-facing wrapper: config/JSON/URL → extended-registry compose → `lowerToIR` → `bootEngine` | `createLumenApp`, `listTemplates`, `LumenApp` | 6–7 |
| `app/cli` (`@lumen/cli`) | `lumen-media` bin: ffmpeg scrub/probe/frame extraction, manifest generation | `scrub`, `probe`, `buildScrubArgs`, manifest emit | 7 |
| `app/builder` | React Builder UI integrating every app package (Team/AI/Designer/Dashboard/Community views, marketplace + creator panels) | UI shell + service singletons | 7 → Waves 14–19 Wave B |
| `app/projects` | Project CRUD, autosave + versioning, storage adapters | `ProjectStore`, `AutosaveManager`, `MemoryStorage`, `LocalStorageAdapter` | 8 |
| `app/settings` | User settings model, schema-versioned store, theme presets, reduced-motion/device-class resolvers | `SettingsStore`, `THEME_PRESETS`, `resolveReducedMotion`, `resolveDeviceClass` | 8 |
| `app/telemetry` | Opt-in, local-only, sanitized telemetry; never throws; zero network | `TelemetryEvent`, sinks (memory/localStorage), `stats()` | 9 |
| `app/billing` | Mock billing (free/pro plans), clock-injected provider, revenue share (phase 15) | `MockBillingProvider`, `PERIOD_MS`, revenue-share module (`revenue.ts`) | 9, extended 15 |
| `app/entitlements` | Feature/template/export gating; template access gating (phase 15) | `EntitlementService`, `EntitlementDeniedError`, `canAccessTemplate` | 9, extended 15 |
| `app/marketplace` | Template metadata/catalog/search/install/update; paid templates + purchases + creator pipeline (phase 15) | `TemplateCatalog`, `Marketplace`, `BUILTIN_TEMPLATES`, `TemplatePurchases`, `CreatorTemplateService` | 10, extended 15 |
| `app/onboarding` | Creator wizard flow engine (template → media → chapters → theme → publish), drafts | `OnboardingWizard`, `createProjectFromWizard`, `saveDraft`/`resumeDraft` | 11 |
| `app/assets` | Hosted asset pipeline over `lumen-media` + `@lumen/assets` manifest seam; optimization queue, device detection | library, queue, manifest-generator, cli-executor, device modules | 12 |
| `app/publish` | Static exporter (config → bundle), budget gate, mock Vercel client, publish history + rollback | `StaticExporter`, `MockVercelClient`, `PublishService`, `BudgetExceededError`, `SNAPSHOT_CAP = 10` | 13 |
| `app/collaboration` | Shared projects: roles, presence, LWW + merge suggestions, invitations, activity log | `CollaborationService`, `ConflictResolver`, `InvitationService`, `PresenceTracker`, `ActivityLog` | 14 |
| `app/ai` | AI authoring assistant: provider seam, heuristic/mock providers, parseConfig-gated generation, suggestion suites | `AIProvider`, `HeuristicProvider`, `MockAIProvider`, `suggestChapterStructure`, `suggestMotionProfiles`, `suggestCameraTracks`, `tagAsset`, `recommendTemplates`, `AIGenerationError` | 16 |
| `app/designer` | Motion designer core: timeline editor model, undo, easing library, config↔timeline serialization, motion graph, frame-step scrub | `UndoStack`, `EASING_LIBRARY`, timeline/graph/serialize/scrub modules | 17 |
| `app/dashboard` | Dashboard aggregation, local-only analytics, preview-before-publish, mock share links | `DashboardService`, `AnalyticsStore`, `PreviewService` | 18 |
| `app/community` | Creator profiles, showcases, remix flow with attribution, threaded local-only comments | profile/showcase/remix/comments modules | 19 |

---

## 3. Delta sections

### 3.1 IR deltas (SceneIR v1 additive fields)

SceneIR is owned by `contracts/src/ir.ts`; `SCENE_IR_VERSION` remained `1`
through v1.1 and through all of v2.0. All changes are **additive optional
fields** — v1 documents validate unchanged; old runtimes ignore unknown keys.

| Field | Type (optional) | Plan | Wire-compat note |
|---|---|---|---|
| `IRTrack.motion` | `'continuous' \| 'reveal' \| 'static'` | P1 | Absent = `continuous`, byte-identical |
| `SceneIR.a11y[sceneId].motion` | same enum (scene default) | P1 | Reads existing wire record |
| `IRAssetRef.variants` | `IRAssetVariant[]` (`src/format/codec/width/bytes/delivery`) | P2 | Absent → legacy manifest synthesis path; `delivery: 'frame-stack'` reserved for P3 |
| `IRNode.anchor` / `IRNode.layerGroup` / `IRNode.rect` | `Vec3` / `string` / `{x,y,width,height}` | P11 | Absent → flat z-index pool and `surface − world.position` fallback |
| `IRTrack.smoothing` | `{mode:'lerp'\|'spring'\|'none', stiffness?, damping?}` | P15 | Passed to driver only when present |
| `IRTrack.segments` | `Array<{id, from, to, keys}>` | P15 | Flattened to keyframes; legacy passthrough |
| `Keyframe.easingBezier` | `CubicBezier` alongside named `easing` | P15 | Old runtimes degrade to nearest named easing |
| `SceneIR.minRuntime` | `string` (advisory) | P8 | Error-payload hint only, never required |

**Wire-format guarantees (re-verified Phase 5, gate #3):** hand-built v1 docs
behave byte-identically in the v1.1+ runtime; `minRuntime` is advisory; new
capabilities are opt-in per field; v2.0's app layer emits SceneIR only through
`lowerToIR` and validates generated configs through `parseConfig`, so no new
wire surface was created in phases 6–19.

### 3.2 Kernel / runtime deltas

| Change | Where | Why | Compatibility |
|---|---|---|---|
| `engine:visibility` bus event; preload pausing while hidden | kernel (P4), `PreloadPauser.setPaused` | Shed background-tab fetch/buffer work | DOM-guarded; Node-safe; elapsed semantics unchanged |
| Longtask attribution; `BudgetReport.source` (`scheduler` vs `longtask`/`external`) | kernel (P4) | Avoid double-counting scheduler overruns | Feature-guarded `PerformanceObserver` |
| `LumenPlugin.optional?: boolean` | kernel (P14) | Optional-plugin init failure degrades gracefully | Required-plugin semantics unchanged |
| Single `MotionPolicy` owner | `runtime/src/motion.ts` (P1) | Replaces three ad-hoc reduced-motion clamps; `reveal` cuts interpolation + quantizes scrub; `static` holds t=0 + poster | Driver *kind* never changes — only interpolation policy |
| `BootOptions.reducedMotion` seam | `packages/runtime/src/engine.ts:70,245` | App layer (settings) can force reduced motion | Defaults to `kernel.capabilities.reducedMotion` |
| `VersionSkewError` + SSR-skeleton fallback | `packages/runtime/src/engine.ts:112–186` | Version mismatch with `data-lumen-skeleton` present → static page stays, silent abort, `engine:error`; hard throw only without skeleton | No skeleton → same hard failure as before |
| Camera evaluation from first `camera` node's world transform | runtime + frame adapter (P5) | Live camera instead of constant | Camera-less scenes keep byte-identical `DEFAULT_CAMERA` |
| a11y hydration (aria labels + live-region announcer) | runtime (P12) | Wire data already existed; idempotent with SSR | Additive DOM attributes only |

### 3.3 Driver deltas (interaction)

| Change | Where | Why | Compatibility |
|---|---|---|---|
| Track segments (reusable fade/hold/out clips) + bezier keyframes | `IRTrack.segments`, `Keyframe.easingBezier` (P15) | Author motion patterns once | Evaluation unchanged when absent |
| Per-track smoothing (`lerp`/`spring`/`none`) | track smoothing (P15) | Data-driven interpolation instead of a global lerp constant | `MotionPolicy` forces `mode:'none'` under reduced motion |
| Unified scroll input (native `scrollTop` routed through the same normalize→multiply→clamp→lerp pipeline as `feedDelta`) | interaction (P9) | One path, one set of clamps | `DriverMap` seam untouched — preserves the future CSS scroll-timeline adapter slot |
| Scroll restoration via `history.state` / `popstate` | interaction (P9) | Browser-back restores scene position | Throttled ≥500 ms; additive |

### 3.4 Rendering deltas

| Change | Where | Why | Compatibility |
|---|---|---|---|
| Grouped stacking contexts (`layerGroup` → pooled context divs) | DOM renderer (P11) | Typed two-level ordering replaces integer z convention | Absent `layerGroup` → flat pool as before |
| Full CSS transform mapping via `matrix3d()` | DOM renderer (P11) | Rotate/skew reach CSS | Absent rotation → bit-identical CSS output; transform string in diff key |
| Explicit `rect` payload policy | frame adapter (P11) | Width/height animatable; layout decoupled from viewport-at-adapt-time | Fallback preserved |
| Decoupled quality ladder: per-axis delta rungs (dpr↓ → msaa↓ → shadows↓ → drop-one-post-pass → …) | quality controller (P13) | Finer degradation than whole-level drops | `QualityLevel` shape unchanged; rungs 0–5 match old ladder exactly |
| Camera wiring into `RenderFrame.camera` | frame adapter (P5) | Real camera motion | No renderer interface change |
| Backends | `packages/rendering/src` | DOM (pool+diff), Canvas2D, WebGL2/Three.js bridge, WebGPU stub; selection by capability profile | Pure capability→renderer chain unchanged |

### 3.5 Template ecosystem deltas

- **Specializations without touching the frozen `TemplateKind` union:**
  `createExtendedRegistry()` (`packages/templates/src/registry.ts`) registers
  specialization descriptors (`scroll-cinema-landing`, `cinematic-story`,
  `product-showcase`) that *replace* the stock descriptors for their kinds in
  the extended registry, distinguished by descriptor id/version and node-meta
  namespacing (`docs/consolidated-agents.md` §"Extending templates").
- **Per-compose id context** (`ComposeContext`, P10) made template helpers
  reentrant/parallel-build-safe; sequential builds byte-identical.
- **Poster SSR fallback + `data-lumen-skeleton`** (P17+P8): crawlable content,
  version-skew fallback surface, reduced-motion `static` poster; removed on
  `render:first-frame`.
- **Marketplace catalog + creator pipeline (phases 10/15):**
  `app/marketplace` adds `TemplateMeta` (categories, tags, thumbnails, tier
  `'free' | 'pro'`), `TemplateCatalog` over pluggable `MarketplaceSource`s
  (built-in + creator), semver install/update (`compareSemver`,
  `TemplateValidationError`), and a creator pipeline
  (`CreatorTemplateService`, `validateCreatorTemplate`, preview descriptors,
  ownership enforcement via `CreatorOwnershipError`). Creator templates become
  first-class catalog sources alongside `BUILTIN_TEMPLATES`.

### 3.6 Marketplace & monetization deltas

- **Metadata/search/install/update (phase 10):** `TemplateMeta` model,
  `SearchFilters`, `CategoryCount`, `Marketplace` install flow with
  `InstalledTemplatesStore` (memory + localStorage) and update detection.
- **Paid templates (phase 15):** `TemplatePrice`, `PaidTemplateMeta` (additive
  intersection with `TemplateMeta`), `withPrice`/`encodePrice` helpers,
  `PRICED_TEMPLATES` catalog, `isPaidTemplateMeta` guard
  (`app/marketplace/src/paid.ts`).
- **Purchases:** `TemplatePurchases` with `PurchaseStore` (memory/localStorage)
  and `MockTemplateBillingProvider` producing charge receipts
  (`app/marketplace/src/purchases.ts`) — the billing seam is typed
  (`TemplateBillingProvider`), the implementation is mock-only.
- **Revenue share:** additive billing module (`app/billing/src/revenue.ts`,
  exported from `app/billing/src/index.ts` under the "Phase 15: revenue share"
  banner).
- **Access gating:** `canAccessTemplate` + `OwnershipResolver` /
  `TemplateAccessMeta` in `app/entitlements/src/gating.ts` — paid templates
  gate on purchase ownership, layered on the phase-9 `EntitlementService`.

### 3.7 Collaboration deltas (phase 14)

`app/collaboration` (`src/`):

- **Roles:** `Role = 'owner' | 'editor' | 'viewer'` with capability predicates
  `canEdit` / `canShare` / `canManageMembers` (`roles.ts`).
- **Membership:** `MembershipStore` with memory + localStorage backends
  (`membership.ts`).
- **Presence:** `PresenceTracker` (`presence.ts`) — local presence entries,
  no network.
- **Conflicts:** `ConflictResolver` implements last-write-wins with
  **merge suggestions** (`MergeSuggestion`, `ApplyEditResult`,
  `conflicts.ts`) — conflicts never silently drop a user's edit; they surface
  a suggestion.
- **Invitations:** `InvitationService`, `DEFAULT_INVITE_TTL_MS` = 7 days
  (`invitations.ts`) — token-based, fully local/mock.
- **Activity log:** capped `ActivityLog` (`ACTIVITY_LOG_CAP = 200`,
  `activity.ts`).
- **Seam discipline:** `CollaborationService` consumes a `ProjectStoreSeam`
  (`types.ts`) so `app/projects` was extended only additively (new files).

### 3.8 AI deltas (phase 16)

`app/ai` — local-first; the default provider is deterministic heuristics and
nothing in the package performs network or filesystem I/O
(`app/ai/src/index.ts` header):

- **Provider seam:** `AIProvider` interface with `HeuristicProvider` (default)
  and `MockAIProvider` (`providers.ts`) — a real LLM backend slots in without
  touching consumers.
- **parseConfig-gated generation:** description → `EngineConfig` generation
  (`generate.ts`, `inferTemplateKind`) is validated through `parseConfig`;
  failures raise `AIGenerationError` with structured `AIGenerationIssue`s
  (`errors.ts`). AI can never emit an invalid config.
- **Suggestion suites:** chapter structure (`suggestChapterStructure`,
  bounds 1–12), motion profiles (`suggestMotionProfiles`,
  `suggestSceneMotion`), camera tracks (`suggestCameraTracks` with moves
  `push-in | pull-back | orbit | pan | settle`).
- **Analysis:** mood detection (`detectMood`, `MOOD_BLUEPRINTS`), title
  extraction, chapter-count inference (`analyze.ts`).
- **Asset tagging:** `tagAsset` + `detectColorwayVariants` (`assets.ts`).
- **Recommendations:** `recommendTemplates` over a `TemplateCatalogLike` seam
  (`recommend.ts`) — composes with `app/marketplace`'s catalog.

### 3.9 Publish pipeline deltas

`app/publish` (phase 13) + `app/dashboard` (phase 18):

- **Static export:** `StaticExporter` lowers an `EngineConfig` (or a
  `{id, name, config}` project) to an in-memory `StaticBundle` via the real
  engine pipeline, with pluggable `ExportSink` (`MemorySink`, `NodeFsSink`)
  and `configHashOf` content addressing (`exporter.ts`).
- **Budgets:** export is budget-gated — violations raise
  `BudgetExceededError` (`BudgetViolation[]`), reusing the engine's budget
  contract; `InvalidConfigError` for unparseable configs.
- **Mock Vercel:** `MockVercelClient` (`vercel.ts`) implements a zero-network
  deploy lifecycle behind the same shape a real Vercel client would use.
- **History & rollback:** `PublishService` keeps publish records + bundle
  snapshots (`SNAPSHOT_CAP = 10`, `MemoryPublishHistoryStore`,
  `service.ts`); rollback redeploys a prior snapshot.
- **Entitlement gate hook:** publish checks plan entitlements (phase 9 seam).
- **Previews & share links (phase 18):** `PreviewService` — in-memory
  preview-before-publish, no deploys, no history pollution; mock share links
  with zero network; `AnalyticsStore` is **local-only, self-reported
  publish-view telemetry — never real traffic** (`app/dashboard/src/index.ts`
  header); `DashboardService` aggregates projects + publish history over the
  `ProjectStore`/`PublishService` seams.

---

## 4. Validation ledger

Test counts verified by counting `test(`/`it(` occurrences in each package's
`test/*.test.mjs` (this phase, on `master @ 388f91a`); v1.1-era numbers from
`docs/analysis/phase5-validation-report.md` and
`docs/stabilization-report.md`.

| Phase wave | Package / scope | Tests |
|---|---|---|
| v0.2 stabilization | all engine packages | 214 pass / 0 fail |
| v1.1 (P1–P17 landed) | all engine packages | 331 package tests (~90 new) + 8 e2e = 339/339 |
| Phase 7 (app foundations) | `app/runtime` | 5 |
| Phase 7 | `app/cli` | 20 (lead plan cited 19; file count verified 20 across 3 files) |
| Phases 8–13 | projects 7, settings 11, billing 16, entitlements 13, telemetry 13, marketplace 26, onboarding 20, assets 33, publish 15 | **154** in wave-2..6 packages (+ runtime 5 + cli 20 from phase 7 ≈ 179 cumulative app-layer; plan ledger cited ~162 for phases 8–13 core set) |
| Phase 14 | `app/collaboration` | 10 |
| Phase 15 (monetization) | marketplace 26 (incl. paid/purchases), billing 16 (incl. revenue), entitlements 13 (incl. gating) | 26 / 16 / 13 |
| Phase 16 | `app/ai` | 20 |
| Phase 17 | `app/designer` | 34 (5 files: easing, graph, scrub, serialize, timeline) |
| Phase 18 | `app/dashboard` | 10 |
| Phase 19 | `app/community` | 11 |
| Every stage gate | `tests/e2e` (smoke + qa-scrub-vendor) | **8/8 green** |
| Every stage gate | all three examples | budgets **PASSED ×3** |

Total app-layer tests on master: **269** across 17 packages (per the counts
above). Stage-gate requirements per wave (from `plan.md`): build-all clean,
per-package tests green, e2e 8/8, example budgets ×3, clean tree — all met at
each merge.

---

## 5. Mock boundaries (intentionally local-only)

Everything below is a **real typed seam with a mock/local implementation** —
swappable without consumer changes. Nothing in `app/*` performs external
network I/O (`plan.md` constraint: "no external network calls (mock
billing/Vercel); local-only telemetry").

| Boundary | Mock / local implementation | Swap-in seam |
|---|---|---|
| Billing | `MockBillingProvider` (`app/billing/src/provider.ts`) | `MockBillingProviderOptions`, clock injection; plans free/pro |
| Template purchases | `MockTemplateBillingProvider` (`app/marketplace/src/purchases.ts`) | `TemplateBillingProvider` interface, charge receipts |
| Deploys | `MockVercelClient` (`app/publish/src/vercel.ts`) | Zero-network deploy lifecycle, same call shape as a real client |
| Export sinks | `MemorySink` default; `NodeFsSink` for CLI use (`app/publish/src/exporter.ts`) | `ExportSink` interface |
| Invitations | `InvitationService` — local token issuance, no email (`app/collaboration/src/invitations.ts`) | TTL-injected (`DEFAULT_INVITE_TTL_MS` = 7d) |
| Share links | Mock links, zero network (`app/dashboard`) | Dashboard service seam |
| AI provider | `HeuristicProvider` default, `MockAIProvider` for tests (`app/ai/src/providers.ts`) | `AIProvider` interface |
| Analytics | `AnalyticsStore` — local-only, self-reported publish views, never real traffic (`app/dashboard/src/analytics.ts`) | Store seam |
| Telemetry | Memory/localStorage sinks only; opt-in; sanitized; zero network (`app/telemetry`) | `TelemetrySink` interface |
| Presence / collaboration transport | `PresenceTracker` + `ConflictResolver` are local; no realtime socket | `CollaborationService` + `ProjectStoreSeam` |
| Storage generally | Every store ships `Memory*` + `LocalStorage*` adapters (projects, settings, membership, purchases, installed templates, creator templates, publish history) | Key-value storage interfaces per package |

---

## 6. v2.0 readiness verdict

| Area | Status | Rationale |
|---|---|---|
| Engine core (contracts/config/kernel/scene) | **READY** | Frozen contracts held through 20 phases; SceneIR v1 additive strategy proven end to end; kernel lifecycle/visibility/plugin semantics validated |
| Scene pipeline (templates → codegen → build → IR) | **READY** | Reentrant compose, extended registry, budgets enforced at build *and* publish-export gates; 339/339 at v1.1 gate, e2e 8/8 throughout |
| Rendering | **READY-WITH-NOTES** | Live camera, stacking contexts, full transforms, decoupled ladder; post-pass names still inert (P6), WebGPU backend still a stub |
| Templates | **READY** | Specialization pattern proven; creator pipeline (upload/metadata/preview/ownership) landed in phase 15 |
| Marketplace | **READY-WITH-NOTES** | Full metadata/search/install/update + paid templates + revenue share; billing and purchase providers are mocks by design |
| Collaboration | **READY-WITH-NOTES** | Roles/presence/LWW+merge-suggestions/invitations/activity all local; no realtime transport (documented mock boundary) |
| AI | **READY-WITH-NOTES** | Provider seam + parseConfig-gated generation + five suggestion suites; default provider is heuristic, no LLM backend shipped |
| Publish | **READY-WITH-NOTES** | Static export + budget gate + history/rollback + previews; Vercel client and share links mocked |
| Builder UX | **READY** | Builder integrates Team/AI/Designer/Dashboard/Community views + marketplace monetization & creator panels (Wave B, commits `e1a431f`/`e677f99`) |
| Docs | **READY** | This consolidation completes phase 20; prior docs (`consolidated-architecture.md`, `consolidated-agents.md`, evolution v1.1) current |

**Overall verdict: v2.0 READY.** Lumen is now a validated platform: a frozen-
contract engine core (unchanged wire format since v1.0) plus a 17-package
application layer with disciplined seams, every external dependency behind an
explicit mock boundary, and every wave passing the full stage gate
(build-all clean, tests green, e2e 8/8, example budgets ×3).

### Known deferred items

1. **P3 — WebCodecs frame-stack scrub substrate** (`delivery: 'frame-stack'`
   wire value already reserved by P2). Blocked on device-lab validation of
   hardware-decoder behavior (iOS concurrent-decoder limits) and a GOP=1
   encode-pipeline milestone. The 120 ms scrub throttle only quantizes
   long-GOP stutter; P3 is the real fix.
2. **P6 — Named post-pass executor** (bloom/grain/vignette/dof registry with
   per-renderer executors). `RenderFrame.post` names remain inert. Blocked on
   GPU-dependent visual validation infrastructure; pairs with a real WebGPU
   renderer.
3. **P16 — Bandwidth estimation + Save-Data awareness** (`NetworkMonitor`
   feeding preload demotion and `pickVariant`). Blocked on real-network
   telemetry to tune EMA windows — untuned throttling is worse than none.
4. **Boot-level DOM tests** — engine boot paths are guarded for Node and
   covered indirectly via e2e, but there is no dedicated jsdom-style boot
   suite; e2e remains the boot gate.
5. **Real backends for mock boundaries** — billing/purchases, Vercel deploys,
   email invitations, share-link hosting, LLM provider, real-traffic
   analytics, and realtime collaboration transport each need a production
   implementation behind the existing typed seams before the platform can
   serve external users.
