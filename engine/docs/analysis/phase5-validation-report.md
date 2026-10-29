# Phase 5 — Independent Validation Report

**Verdict: PASS-WITH-NOTES**

Validated independently by the Phase 5 validation agent against `master @ a4e83ae`.
All builds, test suites, and feature checks below were executed fresh by this agent
(no prior reports trusted). Environment:
`LUMEN_TSCJS=/app/.agents/skills/webapp-building-swarm/templates/0-origin/0-origin/node_modules/typescript/lib/tsc.js`,
root `node_modules/@types/node` present.

## Validation matrix

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Clean-slate rebuild (`rm -rf contracts/dist packages/*/dist dist && bash scripts/build-all.sh`) | PASS | exit 0, 0 `error TS` lines, `build-all: OK`, 11 shims linked |
| 2a | kernel tests | PASS | 28/28 |
| 2b | scene tests | PASS | 26/26 |
| 2c | rendering tests | PASS | 37/37 |
| 2d | assets tests | PASS | 45/45 |
| 2e | interaction tests | PASS | 60/60 |
| 2f | templates tests | PASS | 37/37 |
| 2g | config tests | PASS | 14/14 |
| 2h | codegen tests | PASS | 33/33 |
| 2i | runtime tests | PASS | 47/47 |
| 2j | build tests (`cd packages/build && node --test test/`) | PASS | 4/4 |
| 2k | root e2e (`node --test tests/e2e/`) | PASS | 8/8 |
| 3 | SceneIR v1 compatibility | PASS | `SCENE_IR_VERSION = 1` unchanged (`contracts/src/ir.ts:18`); `isSceneIR` accepts a hand-built v1 doc with no new fields (probe returned `true`, error `null`); `packages/runtime/test/ir.test.mjs` 21/21 incl. "P1: v1 doc without motion validates" (:224), "P15: v1 doc without smoothing/segments validates" (:248), "P2: ref without variants takes the legacy synthesis path" (:121) |
| 4 | Non-breaking public API | PASS | root `dist/index.js` smoke import: 208 exports; all 27 Do-NOT §3 names present (`parseConfig, validateConfig, applyDefaults, migrate, createDefaultRegistry, TemplateRegistry(+7 methods), resolveThemeTokens, toCssVariables(String), generate, generateStatic/WebComponent/Runtime/Npm, lowerToIR, serializeIR, build, buildAll, bootEngine, hydrateIslands, parseSceneIR, manifestFromAssetRefs, composedSceneFromIR, isSceneIR, createEngine, SCENE_IR_VERSION, HASH_LENGTH`); all 20 spot-checked frozen contract type names still declared in `contracts/src/*.ts` |
| 5a | Reduced-motion semantics (P1) | PASS | see notes |
| 5b | Hybrid asset pipeline (P2+P7) | PASS | see notes |
| 5c | Scrub quality (P15) | PASS | see notes |
| 5d | Visibility/jank (P4) | PASS | see notes |
| 5e | Camera tracks (P5) | PASS | see notes |
| 6 | Examples ×3 rebuild | PASS | all `budgets passed: true`; each dist has `index.html` with `data-lumen-skeleton` (×1) + import map (×1), `vendor/` with ≥5 package dirs, hashed `main.*.js` + `hydration-manifest.*.json` containing `irVersion` |
| 7 | phase4 diff doc sanity | PASS (note) | `docs/analysis/phase4-code-patches.diff` exists; 13 `## Pn` sections covering 14 patches (P17+P8 combined in one section); contracts hunks spot-checked against `git show d73297e`/`cc89563` — content matches |
| 8 | Git hygiene | PASS | linear master log (no merges), `git status` clean, 0 tracked `node_modules` paths |

**Totals: 331 package tests + 8 e2e = 339/339 passing.**

## Per-concern integration notes

### 5a — Reduced-motion semantics (P1)
- Wire format: `MotionMode = 'continuous' | 'reveal' | 'static'` at `contracts/src/ir.ts:47`; optional per-track `motion?: MotionMode` at :57; `MotionPolicy` interface at :69-82.
- Runtime: `packages/runtime/src/motion.ts` is the single policy owner — `'static'` clamps time tracks to t=0 (:59, :67), `'reveal'` passes time but cuts interpolation and quantizes scrub seeks (:8-11 header contract); `reducedMotion` capability maps to `'reveal'` default (:40).
- Engine wiring: `MotionPolicy` is constructed in `engine.ts` and injected into `InteractionManager` (`engine.ts:297-300`).
- Tests: `packages/runtime/test/motion.test.mjs` (+scrub/camera files) — combined run 27/27 pass.

### 5b — Hybrid asset pipeline (P2 variants + P7 selection)
- `IRAssetVariant` (src/format/codec/width/bytes/delivery incl. `'gop1' | 'frame-stack'`) at `contracts/src/ir.ts:88-99`; `IRAssetRef.variants?: IRAssetVariant[]` optional at :112 — legacy refs without variants keep the old synthesis path (ir.test.mjs:121).
- Selection: `pickVariant(profile, variants, kind)` in `packages/assets/src/variants.ts:26` — codec-support filter with never-starve fallback (:40-45), low-memory clamp (:48-52), widest-within-2×-dpr-viewport choice (:55-63).
- Tests: `packages/assets/test/variants.test.mjs` pass (within assets 45/45).
- P3 (WebCodecs frame-stack scrub) and P16 (bandwidth estimation) correctly remain **plan-only**: present only in `docs/analysis/phase3-implementation-plans.md` (P3 :294, P16 :963); no implementation commits on master. The wire format already reserves `delivery: 'frame-stack'` for P3.

### 5c — Scrub quality (P15)
- `TimelineTrack.smoothing?: TrackSmoothing` (`contracts/src/scene.ts:155-156`), `IRTrack.smoothing?`/`segments?` (`contracts/src/ir.ts:58-61`).
- Scene layer flattens reusable segments into keyframes with a legacy passthrough when absent (`packages/scene/src/timeline.ts:110-123`).
- Runtime passes per-track smoothing descriptors into the interaction driver only when present (`packages/runtime/src/engine.ts:301-306` → `trackSmoothing`), so v1 docs get byte-identical behavior.
- Scrub wiring (`packages/runtime/src/scrub.ts`) routes `playback.time` playheads to video `seekTo()` with throttle; `packages/runtime/test/scrub.test.mjs` passes.

### 5d — Visibility / jank (P4)
- `engine:visibility` bus event emitted on `visibilitychange`, DOM-guarded for Node safety (`packages/kernel/src/kernel.ts:84-93`).
- Longtask observer: `PerformanceObserver` feature-guarded with try/catch fallback to null (`kernel.ts:97-113`); emits `scheduler:budget-exceeded` with `source: 'longtask'`, `phase: 'external'`, `budgetMs: 50`; disconnected on teardown (:173-174).
- Preload shedding: `PreloadPauser.setPaused(on)` at `packages/assets/src/preload.ts:87-95`, exercised in `packages/assets/test/preload.test.mjs:157-159`.
- Kernel suite (28/28) covers visibility + longtask guards (`packages/kernel/test/kernel.test.mjs`).

### 5e — Camera tracks (P5)
- `packages/runtime/src/camera.ts`: first `'camera'` node found depth-first (:18-24); its world transform drives `RenderFrame.camera`; camera-less scenes keep byte-identical `DEFAULT_CAMERA` (:6-7 header).
- Engine: camera node resolved once at boot (`engine.ts:198-201`), evaluated per frame from the graph world transform (:370-373); reduced-motion policy still snaps camera playheads upstream.
- Tests: `packages/runtime/test/camera.test.mjs` passes (within runtime 47/47).

## Deviations accepted

1. **Phase-4 diff doc has 13 `## Pn` sections, not 14** — P17 and P8 share one combined section (matching their combined commit `7737c38`). All 14 patch ids are covered; accepted.
2. **Fuse mount (`/mnt/agents`, fuse.portal) consistency artifacts**: the first two clean-slate rebuild attempts on the mount showed `contracts/dist` empty immediately after a successful contracts `tsc` (kernel then failed with TS2305). The identical tree copied to local ext4 built with zero errors on first attempt, and a later retry of the exact clean-slate procedure on the mount also succeeded with zero errors (`build-all: OK`). Root cause is mount read-after-write consistency, not the codebase. All final numbers above were re-run on the real mount after a successful rebuild.
3. Example rebuilds touch only `dist/manifest.json` `generatedAt` timestamps; reverted to keep the tree clean (`git status` clean at report time).

## Residual risks

- **Mount flakiness** can make clean rebuilds appear to fail; CI on this mount should retry or verify `contracts/dist/index.d.ts` exists before downstream compiles.
- `pickVariant` never-starve fallback silently ignores codec constraints when all variants are filtered out (`variants.ts:44`) — intentional, but means a fully-unsupported codec set degrades to legacy order rather than an explicit signal.
- P3/P16 plan-only means high-end scrub quality and bandwidth adaptation are still unimplemented; the reserved `delivery: 'frame-stack'` variant value has no producer/consumer yet.
- Longtask attribution depends on browser `PerformanceObserver` longtask support; unsupported environments get no external-jank signal (by design, guarded).
