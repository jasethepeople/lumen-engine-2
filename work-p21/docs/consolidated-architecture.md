# Consolidated Architecture — Lumen v0.2 (stabilized)

One-page distillation of [architecture.md](architecture.md),
[stabilization-report.md](stabilization-report.md),
[refactor-changelog.md](refactor-changelog.md), and
[guide/07-template-designs.md](guide/07-template-designs.md), verified against
the code on `master` (v0.2). Normative source: [SPEC.md](../SPEC.md).

## Modules (11 packages + contracts)

| Package | Role (one line) |
| --- | --- |
| `@lumen/contracts` | All cross-module types, frozen, zero deps — owns `SceneIR` (`contracts/src/ir.ts`, `SCENE_IR_VERSION = 1`). |
| `@lumen/config` | `parseConfig`: migrate → validate → defaults for `EngineConfig` (schema v3); validator combinators internal. |
| `@lumen/templates` | `TemplateDescriptor`s map config + `AssetManifest` → `ComposedScene`; single home of theme helpers (`resolveThemeTokens`, `toCssVariables(String)`). |
| `@lumen/codegen` | Lowers scene to versioned `SceneIR`, emits 4 targets (static / webcomponent / runtime / npm) + `hydration-manifest.json` + import graph; delegates theme/CSS-var emission to templates. |
| `@lumen/build` | Phased pipeline (validate → generate → optimize → hash → emit → report); content hashing, gzip budgets, `manifest.json`; codegen injected (`GenerateFn`), never imported. |
| `@lumen/kernel` | Lifecycle state machine, typed event bus, rAF scheduler (16 ms budget), capability detection, plugin registry; `boot()` deprecated alias of `start()`. |
| `@lumen/scene` | Pure DOM-free scene graph, dirty-flag world transforms, timeline evaluation (`createSceneRuntime`/`evaluate` in `src/runtime.ts`). |
| `@lumen/rendering` | `IRenderer` backends (DOM, Canvas2D, WebGL2/Three.js, WebGPU stub), backend selection, adaptive quality; owns WorldState→DrawCall conventions (`src/frame-adapter.ts`). |
| `@lumen/assets` | Manifest handling, priority preloading (critical→eager→lazy), two-tier cache (LRU + Cache API/IndexedDB), per-kind loaders. |
| `@lumen/interaction` | Input normalization, gestures, virtual scroller, interaction→timeline bindings with a11y fallbacks. |
| `@lumen/runtime` | Browser orchestration glue: `bootEngine`, `hydrateIslands`, `parseSceneIR`, `composedSceneFromIR`, `manifestFromAssetRefs`, scroll scrubber. |

## Data flow

```
build time: config ──▶ validate ──▶ compose ──▶ codegen ──▶ build ──▶ artifacts
runtime:    artifacts ──▶ bootEngine ──▶ kernel/scheduler ──▶ interaction ──▶
            scene evaluate ──▶ drawCallsFromWorldState ──▶ renderer ──▶ pixels
```

## Invariants checklist (all verified in source)

### Template layering & scroll model (`packages/templates/src/`)

- **Z-layering** (`scroll-cinema-landing.ts`): video plane `layer: 0`, chapters
  `10`, hero caption + outro `20`, logo `30`. (cinematic-story: acts `5`,
  title-card/credits `10`.)
- **scrollRange normalization/clamping**: chapter `meta.scrollRange` and
  default equal slices clamped to `[0, totalRange]`
  (`Math.min(Math.max(x, 0), totalRange)`); `totalRange` derived from scene
  `track.durationOrRange` with a `|| 1` degenerate guard (`scroll-video.ts`).
- **Parallax**: `PARALLAX_SCALE = [1.0, 1.08]`, linear keyframes over full
  scroll bound to `transform.scale` (`scroll-cinema-landing.ts:45,136-137`).
- **Keyframed transitions + 1.2 s crossfade** (`cinematic-story.ts`):
  `CROSSFADE_S = 1.2`; every sequenced scene gets a 4-keyframe
  `material.opacity` track (`0→1` first 1.2 s, hold, `1→0` last 1.2 s); the
  clock overlaps consecutive scenes by `CROSSFADE_S`, clamped non-negative.
- **Reduced motion**: crossfade keyframes use `easing: 'linear'`; scene groups
  carry `meta['cinematic-story'].reducedMotion = { transition: 'cut' }`;
  interaction honors `CapabilityProfile.reducedMotion` with instant snap-step
  a11y fallback (`interaction/src/manager.ts`).

### SceneIR & contracts

- **SceneIR wire v1**: `contracts/src/ir.ts` owns `SceneIR`, `IRNode`,
  `IRTrack`, `IRBinding`, `IRAssetRef`, `SCENE_IR_VERSION = 1`; codegen
  re-exports, runtime imports (single-owner rule, refactor C2).
- **Duration plumbing**: additive `duration?: number` on `AssetRef` /
  `IRAssetRef` (0/omitted = unknown); scroll templates fall back to
  `totalRange` when video duration is missing; scrub keyframes `0 → duration`.
- **Hydration manifest**: codegen emits `hydration-manifest.json` (island node
  ids + SSR flag); runtime consumes it via
  `hydrateIslands(engine, ir.hydration.islands)`.

### Build output & budgets

- **Budgets**: per-metric gzip budgets with pass/warn/fail; template
  `PerformanceBudget` can tighten; `strictBudgets` fails the build
  (`packages/build/src/pipeline.ts`). Runtime side: 16 ms frame budget emits
  `scheduler:budget-exceeded`; adaptive quality ladder with hysteresis/cooldown.
- **`manifest.json` structure**: deploy manifest written at the emit phase
  (`MANIFEST_NAME = 'manifest.json'`); stale files cleaned against the
  emitted + vendored + manifest set.
- **dist layout** (examples): `index.html` (SSR shell + critical CSS +
  `#lumen-scene-ir`), `main.<hash>.js`, `hydration-manifest.<hash>.json`,
  `manifest.json`.
- **Vendor runtime + import map**: build vendors compiled `@lumen/*` packages
  into `dist/vendor/<pkg>/` (`vendorRuntimePackages`, default on for static,
  excluded from budgets); codegen emits `importMapScript()` into static
  `index.html` so bare `@lumen/*` imports resolve in browsers.

### Browser & runtime hardening

- **100dvh fallback**: critical CSS emits `min-height:100vh;min-height:100dvh`
  (`codegen/src/common.ts`), plus `viewport-fit=cover` and
  `visualViewport.resize` listening.
- **touch-action pan-y**: same critical-CSS rule (`touch-action:pan-y`);
  passive touch handlers feed the virtual scroller.
- **WebGL context loss/restore**: `webglcontextlost`/`webglcontextrestored`
  handled in `rendering/src/renderer-webgl.ts`; pooled geometries/materials
  disposed; `<lumen-embed>` uses generation-token boot + dispose-before-reboot.
- **Plugin init error propagation**: `plugins.initAll` failures emit
  `engine:error` AND rethrow → `kernel.start()` rejects (BOOT_FAILED)
  (`kernel/src/plugin.ts:114-117`, `kernel.ts:105`).
- **Boot-failure guard**: `bootEngine` wraps boot in try/catch →
  `kernel.dispose()` + canvas removal; double-boot guard via
  `dataset.lumenBooted`; generated HTML adds `.catch` + `role="alert"`
  fallback + `lumen:boot-error` event (`runtime/src/engine.ts`).
- **seekTo clamping**: scrubber skips non-finite/negative playheads
  (`Number.isFinite`, `raw < 0` guard), throttles seeks (120 ms default), and
  `seekTo` is finite-clamped with 5 s timeout + error-event rejection
  (`runtime/src/scrub.ts`).

## Cross-cutting conventions

- TypeScript strict, ESM, ES2022; public API per package is `src/index.ts`.
- Unified build convention: single `tsconfig.json` per package, flat `dist/`,
  uniform `package.json` entries; build order lives solely in
  `scripts/build-all.sh` (sole exception: `packages/build/tsconfig.test.json`).
- Contracts sacred: shared types only in `contracts/`; gaps → local adapters
  documented in package READMEs; cross-module coupling minimized by injection.
- Kernel/scene/config/contracts have zero required runtime deps; Three.js and
  HLS.js are optional dynamic imports behind fallbacks.
- DOM access guarded everywhere → core unit-tests run under `node --test`.
- Validation state (v0.2): `build-all.sh` clean; e2e 8/8; package tests
  214 pass / 0 fail; all three examples rebuild with budgets PASSED.
