# Lumen Architecture

Condensed overview of how the engine fits together. The normative source is
[SPEC.md](../SPEC.md); per-module detail lives in each package README.

## Module map

| Layer       | Package            | Role |
| ----------- | ------------------ | ---- |
| Contracts   | `@lumen/contracts` | All cross-module types, frozen, dependency-free. The only allowed home for shared types — including the `SceneIR` codegen↔runtime handshake (`contracts/src/ir.ts`). |
| Config      | `@lumen/config`    | Validate/migrate/default the authored `EngineConfig`. Validator combinators are internal; the package root exports only the schema surface. |
| Templates   | `@lumen/templates` | `TemplateDescriptor`s map config + asset manifest → `ComposedScene`; own slots, theme defaults, module requirements, budgets. Single home of the theme helpers (`resolveThemeTokens`, `toCssVariables(String)`). |
| Codegen     | `@lumen/codegen`   | Lowers config + scene to a serializable `SceneIR`, emits per-target entry modules + hydration manifest. Delegates theme merging/CSS-var emission to `@lumen/templates` (value dependency). |
| Build       | `@lumen/build`     | Phased pipeline (validate → generate → optimize → hash → emit → report), content hashing, size budgets. |
| Kernel      | `@lumen/kernel`    | Lifecycle state machine, typed event bus, rAF scheduler with frame budgets, capability detection, plugin registry. `boot()` is a deprecated alias of `start()`. |
| Scene       | `@lumen/scene`     | Scene graph with dirty-flag world transforms, timeline evaluation, property bindings. Pure/DOM-free. Scene instantiation lives in `src/runtime.ts` (`createSceneRuntime`/`evaluate`). |
| Rendering   | `@lumen/rendering` | `IRenderer` backends (DOM, Canvas2D, WebGL2 via Three.js, WebGPU stub), backend selection, adaptive quality. Owns the WorldState→DrawCall payload conventions (`src/frame-adapter.ts`: `drawCallsFromWorldState`/`drawCallForNode`). |
| Assets      | `@lumen/assets`    | Manifest handling, priority preloading, two-tier cache (LRU + Cache API/IndexedDB), per-kind loaders. |
| Interaction | `@lumen/interaction` | Input normalization, gesture recognizers, virtual scroller, interaction→timeline bindings with a11y fallbacks. |
| Runtime     | `@lumen/runtime`   | Browser orchestration glue: boots generated SceneIR into a live kernel/scene/renderer loop (`bootEngine`, `hydrateIslands`, `parseSceneIR`, `composedSceneFromIR`, `manifestFromAssetRefs`). |

## Data flow

```
build time:   config ──▶ validate ──▶ compose ──▶ codegen ──▶ build ──▶ artifacts
runtime:      artifacts ──▶ boot (kernel) ──▶ frame loop ──▶ pixels
```

1. **Config** (`@lumen/config`). The author writes an `EngineConfig`
   (JSON/JSONC or object). `parseConfig` runs **migrate → validate →
   defaults** and returns a fully typed `EngineConfig` (schema v3) or a list
   of errors with JSON paths.
2. **Compose** (`@lumen/templates`). The `TemplateDescriptor` selected by
   `config.template` composes the config plus an `AssetManifest` into a
   `ComposedScene`: a scene-graph forest, timeline tracks, resolved theme
   tokens, hydration hints. Templates declare their `ModuleRequirement` (which
   renderer backends, asset features, and interaction sources they need) so
   codegen can tree-shake.
3. **Codegen** (`@lumen/codegen`). `generate(config, descriptor, scene,
   options)` lowers the composed scene to a versioned JSON `SceneIR` (the
   wire format is owned by `@lumen/contracts` — `ir.ts` — and re-exported by
   codegen and runtime), then emits per-target modules. Theme merging and
   CSS-variable emission come from `@lumen/templates`, so SSR/critical CSS
   uses the same `--lumen-*` variable names as runtime DOM theming:
   - `static` — `index.html` (SEO meta, critical CSS from theme tokens,
     `<noscript>`, SSR skeleton) + a boot module embedding the IR.
   - `webcomponent` — self-contained `<lumen-embed>` custom element.
   - `runtime` — a loader that fetches SceneIR/config JSON by URL.
   - `npm` — a library entry with a preconfigured `create<SiteId>Engine()`.
   Also emits `hydration-manifest.json`, an import graph, and non-fatal
   warnings (`missing-asset`, `oversized-inline-json`, a11y gaps, …).
4. **Build** (`@lumen/build`). `build(config, generate)` runs the phased
   pipeline. Codegen is *injected* (`GenerateFn`) — build never imports
   codegen; the integration layer wires them. Output files are content-hashed
   (`name.<hash>.ext`, import specifiers rewritten), a `manifest.json` deploy
   manifest is written, stale files cleaned, and gzip sizes are measured
   against budgets (`strictBudgets` fails the build).
5. **Runtime boot** (kernel + friends). Generated code boots the engine:
   the kernel detects capabilities, initializes plugins in topological order,
   preloads critical assets, selects a renderer backend
   (`webgpu → webgl2 → canvas2d → dom`), and starts the scheduler.
6. **Frame loop**. Each rAF tick the kernel scheduler (16 ms default budget)
   calls `InteractionManager.update(dt)` → a `DriverMap` of
   track-id → seconds; `SceneRuntime.evaluateAt(time, { drivers })` resolves
   world state (dirty subtrees only); the runtime maps the world state to
   `DrawCall`s via `@lumen/rendering`'s frame adapter
   (`drawCallsFromWorldState`, `frame-adapter.ts` — rendering owns the
   payload conventions its renderers decode); the renderer draws the
   `RenderFrame` and fills `FrameStats`; the `AdaptiveQualityController`
   steps the quality ladder when the frame-time EMA crosses thresholds.

## The contract package rule

**Contracts are sacred** (SPEC sacred rule #1): every type shared between
modules lives in `contracts/src/` and nowhere else. Modules import them via
`@lumen/contracts` and add *no* runtime dependencies to that package. If a
contract gap is found, the module implements a **local adapter** and documents
it in its README (examples: interaction's `PointerSample` extends
`NormalizedInputEvent` with pointer phase; scene aliases `material.*` binding
paths to `payload.material.*`). Cross-module calls are minimized further by
injection: assets reports progress through an injected `emit`, build receives
codegen as an injected function.

## Budgets

Performance budgets are enforced at two levels:

- **Build time** (`@lumen/build`): gzip-measured size budgets per metric with
  pass/warn/fail. Defaults derive from the architecture budgets
  (170 KB gz JS, 1.2 MB critical assets, …); each template can tighten them
  via its `PerformanceBudget` (`jsGzBytes`, `criticalAssetBytes`,
  `firstFrameMs`). `strictBudgets` turns failures into build errors (CI mode).
- **Runtime** (`@lumen/kernel` + `@lumen/rendering`): the scheduler enforces a
  per-frame budget (default 16 ms) and emits `scheduler:budget-exceeded`; the
  `AdaptiveQualityController` reacts by stepping DPR scale, MSAA, post passes,
  and shadow resolution down (and back up) with hysteresis + cooldown.

## Cross-cutting conventions

- TypeScript strict, ESM, ES2022 target; each package's public API is
  `src/index.ts`.
- **Unified build convention** (SPEC rule 3a): every package builds from a
  single `tsconfig.json` (`rootDir: "src"`, flat `dist/`,
  `@lumen/contracts` resolved against `contracts/dist`), with uniform
  `package.json` entries (`main`/`types`/`exports` → `./dist/index.*`,
  `files: ["dist", "README.md"]`, `build`/`typecheck`/`test` scripts).
  Build order (contracts first, runtime and the root entry last) lives
  solely in `scripts/build-all.sh`; `scripts/link-workspaces.mjs` shims
  every package as `<dir>/dist/index.js`. The one sanctioned exception is
  `packages/build/tsconfig.test.json`, which compiles that package's
  TypeScript tests.
- Kernel/scene/config/contracts have **zero required runtime dependencies**;
  Three.js (rendering) and HLS.js (assets) are optional and loaded via dynamic
  import behind fallbacks.
- DOM access is guarded everywhere, so core logic unit-tests under
  `node --test` without a browser.
