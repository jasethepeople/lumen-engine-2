# API Index

Key exported symbols per package (each package's full surface is its
`src/index.ts`; details in the package READMEs). All packages are ESM,
TypeScript strict.

## `@lumen/contracts` (`contracts/`)

Frozen cross-module types, re-exported from a single `index.ts`.

| Symbol | Description |
| ------ | ----------- |
| `EngineConfig`, `SceneConfig`, `SceneNodeConfig`, `AssetRef`, `InteractionConfig`, `ConfigMigration` | The declarative config DSL (schema v3). |
| `TemplateKind`, `TemplateDescriptor`, `SlotDefinition`, `ThemeTokens`, `ModuleRequirement`, `PerformanceBudget` | Template contracts for the 4 frontend types. |
| `KernelHandle`, `KernelContext`, `LumenPlugin`, `LifecyclePhase`, `EngineEventMap`, `EngineError`, `CapabilityProfile`, `BudgetReport` | Kernel lifecycle, plugin, capability, and event contracts. |
| `IRenderer`, `RenderFrame`, `DrawCall`, `FrameStats`, `CameraState`, `QualityLevel`, `RendererBackend`, `TextureAsset` | Renderer interface and frame contracts. |
| `SceneNode`, `Transform`, `TimelineTrack`, `Keyframe`, `PropertyBinding`, `ComposedScene` | Scene graph and timeline contracts. |
| `AssetManifest`, `AssetEntry`, `AssetKind`, `LoadState`, `PreloadStrategy` | Asset pipeline contracts. |
| `NormalizedInputEvent`, `InteractionBinding`, `InputSource`, `GestureType`, `A11yFallback`, `VirtualScroller`, `SmoothingConfig` | Interaction contracts. |
| `CodegenTarget`, `CodegenOptions`, `CodegenResult` | Codegen target/result contracts. |
| `BuildArtifact`, `BuildOptions`, `SizeBudget` | Build pipeline contracts. |
| `SceneIR`, `IRNode`, `IRTrack`, `IRBinding`, `IRAssetRef`, `SCENE_IR_VERSION` | SceneIR handshake document (codegen → generated code → runtime); owned here (`ir.ts`), wire format frozen. |

## `@lumen/config`

| Symbol | Description |
| ------ | ----------- |
| `parseConfig` | Top-level entry: object or JSON/JSONC string → migrate → validate → defaults. |
| `validateConfig`, `engineConfigSchema`, `CONFIG_VERSION` | Raw object validation against the full schema (current version 3). |
| `applyDefaults`, `deepMerge`, `DEFAULT_BUILD`, `DEFAULT_PRELOAD_BY_KIND`, `DEFAULT_THEME_TOKENS` | Defaults applicator and default tables. |
| `migrate`, `migrations` | Linear migration registry + runner (v0 → v3). |
| `ValidationError` (type) | Validation error type. The validator combinators (`object`/`string`/`union`/…) are internal to `src/validate.js` and no longer exported from the package root. |

## `@lumen/templates`

| Symbol | Description |
| ------ | ----------- |
| `scrollVideoTemplate`, `cinematicSpaTemplate`, `viewer3dTemplate`, `storytellingTemplate` | The four `TemplateDescriptor`s. |
| `SCROLL_VIDEO_SLOTS`, `CINEMATIC_SPA_SLOTS`, `VIEWER_3D_SLOTS`, `STORYTELLING_SLOTS` | Slot definitions per template. |
| `*_THEME_DEFAULTS`, `VIEWER_3D_CAMERA_DEFAULTS` | Per-template theme/camera defaults. |
| `TemplateRegistry`, `createDefaultRegistry()` | Registry of descriptors; `registry.get(kind)`. |
| `resolveThemeTokens`, `toCssVariables`, `toCssVariablesString` | Merge token overrides; emit CSS custom properties. |
| `defaultTypeScale`, `defaultSpacing`, `defaultMotion` | Shared token defaults. |

## `@lumen/codegen`

| Symbol | Description |
| ------ | ----------- |
| `generate(config, descriptor, scene, options)` | Emit a `CodegenResult` for the target in `options`. |
| `generateStatic`, `generateWebComponent`, `generateRuntime`, `generateNpm` | Per-target generators (usually via `generate`). |
| `lowerToIR`, `serializeIR`, `walkIR` | SceneIR lowering/serialization/traversal. `SceneIR`, `IRNode`, `IRTrack`, `IRBinding`, `IRAssetRef`, `SCENE_IR_VERSION` are owned by `@lumen/contracts` (`ir.ts`) and re-exported here. |
| `CodeWriter`, `ImportManager`, `SourceFileBuilder` | Dependency-free emission toolkit. |
| `escapeHtml`, `escapeString`, `inlineJson`, `minifySource`, `safeIdentifier`, `isIdentifier` | Emission helpers. |

## `@lumen/build`

| Symbol | Description |
| ------ | ----------- |
| `build(config, generate, options?)` | Run the pipeline for one target (codegen injected). |
| `buildAll(options, generate)` | Build every target into per-kind subdirectories. |
| `runPipeline`, `hashPlannedFiles` | Phased pipeline internals: validate → generate → optimize → hash → emit → report. |
| `contentHash`, `hashedFilename`, `rewriteImportPaths` | Content hashing + specifier rewriting. |
| `DEFAULT_BUDGETS`, `checkBudgets`, `gzipSize` | Budget defaults (170 KB gz JS, 1.2 MB critical, …) and evaluation. |
| `formatReportText`, `formatReportJson` | Human and CI-JSON reports. |
| `resolveStrategy`, `isTargetKind` | Per-target output strategies. |

## `@lumen/kernel`

| Symbol | Description |
| ------ | ----------- |
| `createKernel(options?)` | Full kernel: lifecycle + bus + scheduler + capabilities + plugins. |
| `createLifecycle` | `created → booting → loading → ready → active ⇄ paused → disposed` state machine. |
| `createEventBus` | Typed pub/sub over `EngineEventMap`, wildcard listeners, error isolation. |
| `createScheduler` | rAF loop, per-frame priorities, 16 ms budget, `scheduler:budget-exceeded`. |
| `detectCapabilities`, `probeCodecs`, `detectWebGL2`, `detectWebGPU`, `detectDpr` | One-shot immutable `CapabilityProfile` (guarded, injectable). |
| `createPluginRegistry`, `resolvePluginOrder` | `LumenPlugin` DAG resolution, topological init. |
| `createEngineError`, `guard`, `guardAsync`, `toEngineError` | Error boundaries; contained failures → `engine:error`. |

## `@lumen/scene`

| Symbol | Description |
| ------ | ----------- |
| `SceneGraph` | Hierarchy with dirty-flag world transforms, edits, serialize/deserialize. |
| `evaluateTrack`, `evaluateTrackAtProgress`, `applyEasing`, `cubicBezierEase`, `interpolateKeyframes` | Timeline evaluation (easing, loop modes, scrub). |
| `resolvePlayheads`, `applyBindings`, `setByPath` | Driver-agnostic property binding via dotted paths. |
| `evaluate(composed, t, drivers)` | Pure world-state snapshot (codegen/SSR/tests). |
| `createSceneRuntime`, `SceneRuntime` | Stateful per-frame evaluation; dirty subtrees only. |
| `vec3`, `lerp`, `quatMul`, `quatNlerp`, `composeTransform`, … | Math toolkit (`math.ts`, `export *`). |

## `@lumen/rendering`

| Symbol | Description |
| ------ | ----------- |
| `selectRenderer(profile, preference?)` | Fallback chain `webgpu → webgl2 → canvas2d → dom`. |
| `createRenderer(backend, opts)` | Construct a backend with auto-fallback on recoverable failure. |
| `DomRenderer` | CSS-transformed element backend (browser-only). |
| `Canvas2DRenderer` | Dependency-free 2D canvas backend. |
| `WebGLRenderer` | Three.js backend (optional peer, lazy dynamic import). |
| `AdaptiveQualityController` | Frame-time EMA quality ladder with hysteresis + cooldown. |
| `RenderingError` | Typed errors (`RENDERER_UNAVAILABLE`, …). |
| `drawCallForNode`, `drawCallsFromWorldState` | WorldState → DrawCall adapter (`frame-adapter.ts`); rendering owns the renderer payload conventions consumed by the runtime frame loop. |

## `@lumen/assets`

| Symbol | Description |
| ------ | ----------- |
| `createAssetManager()`, `AssetManager` | Facade: `init`, `preload`, `get`, `state`, `stats`, `abort`, `dispose`. |
| `normalizeManifest`, `resolveAssetUrl`, `groupByPriority`, `contentHashKey` | Manifest validation/normalization, CDN URL + hash-key derivation. |
| `loadAsset` | Per-kind loaders (image/video/model/font/lottie/audio) with `LoadState` transitions. |
| `preload`, `AssetPriorityQueue`, `buildQueue` | Priority queue (critical → eager → lazy), concurrency-limited pool. |
| `LruCache`, `PersistentCache`, `AssetCache` | Two-tier cache: memory LRU + Cache API/IndexedDB. |

## `@lumen/interaction`

| Symbol | Description |
| ------ | ----------- |
| `InteractionManager` | Facade: `attach`, `registerBinding(s)`, `update(dt) → DriverMap`, `detach`. |
| `InputNormalizer` | DOM input → `NormalizedInputEvent` (viewport-normalized, guarded). |
| `GestureRecognizer`, `createDoubleTapDetector` | Pure gesture state machines (tap/pan/pinch/swipe/long-press). |
| `LumenVirtualScroller` | Frame-deterministic smoothed scroll playhead with snapping. |
| `BindingRuntime`, `mapInputToOutput`, `snapValue`, `stepValues` | Interaction→timeline mapping, smoothing, a11y step fallback. |

## `@lumen/runtime`

Browser orchestration layer; consumed mainly by generated code (string
specifier `@lumen/runtime`, no value dependency from codegen).

| Symbol | Description |
| ------ | ----------- |
| `bootEngine(root, ir, options?)`, `BootOptions`, `LumenEngine` | Boot a serialized `SceneIR` into a live kernel/scene/renderer loop. |
| `hydrateIslands(engine, islands)` | Hydrate SSR island regions. |
| `parseSceneIR`, `isSceneIR`, `composedSceneFromIR` | SceneIR parsing/guard and reconstruction of a `ComposedScene`. |
| `manifestFromAssetRefs` | Synthesize an `AssetManifest` from config asset refs. |
| `asKernelHandle` | Narrow the engine to the frozen `KernelHandle` contract. |
| `SceneIR`, `IRNode`, `IRTrack`, `IRAssetRef`, `SCENE_IR_VERSION` (types) | Re-exported from `@lumen/contracts` for source compatibility; the single declaration lives in `contracts/src/ir.ts`. |

## Root entry (`index.ts`)

The root re-exports `export *` from every package except two deliberate
explicit blocks: `@lumen/config` (validator combinators stay internal, so
the schema surface is listed by name) and `@lumen/runtime` (the SceneIR
types already arrive via contracts/codegen; only the behavior functions are
listed). Plus `createEngine()` / `EngineDescriptor`, which wire
`parseConfig → registry → compose → { boot, build }`.
