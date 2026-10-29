# Lumen Engine — Refactor Proposal

Scope audited: `contracts/`, `packages/{kernel,rendering,scene,assets,interaction,templates,codegen,config,build,runtime}`, root `index.ts`, `SPEC.md`, `docs/`, `scripts/`, `tests/e2e/`. All file references verified against the working tree.

Legend: **[MUST]** = do in this pass, **[OPT]** = optional (do only if time allows). Risk = chance of breaking tests/build if done carefully.

---

## 1. Module boundary map

Value/type import edges (from `grep "from '@lumen/"` over all `src/`):

| Edge | Kind | Coupling surface (contract types) | Judgment |
|---|---|---|---|
| every package → `@lumen/contracts` | type-only | entire frozen contract surface (`EngineConfig`, `SceneNode`, `ComposedScene`, `ThemeTokens`, `IRenderer`, `DrawCall`, `KernelHandle`, `InteractionBinding`, `AssetManifest`, `CodegenResult`, `BuildArtifact`, …) | **justified** — this is the SPEC's core rule ("contracts are sacred") |
| `runtime` → `kernel` | value | `createKernel`, `Kernel`, `KernelOptions` | **justified** — runtime is the orchestrator |
| `runtime` → `scene` | value | `createSceneRuntime`, `applyBindings`, `resolvePlayheads` | **justified** |
| `runtime` → `rendering` | value | `createRenderer`, `selectRenderer`, `AdaptiveQualityController` | **justified**, but see hotspot H2 (runtime encodes renderer payload conventions) |
| `runtime` → `assets` | value | `createAssetManager`, `AssetManager` | **justified** |
| `runtime` → `interaction` | value | `InteractionManager`, `DriverMap` | **justified** |
| root `index.ts` → all 11 packages | value+type | re-export surface + `createEngine()` wiring | **justified** as the single entry point, but the cherry-picked export lists are a **symptom** (hotspot H1) |
| `codegen` → `@lumen/runtime` | **string-only** (`RUNTIME_SPECIFIER = '@lumen/runtime'` in `codegen/src/common.ts:31`; emitted import statements in `gen-runtime.ts:25`, `gen-npm.ts:26,45`) | generated code imports `bootEngine`, `hydrateIslands` | **justified and good** — codegen must not value-depend on runtime; but the handshake it emits is typed twice (see D4) |
| `codegen` → templates | none (descriptor injected as `generate(config, descriptor, scene, options)`) | `TemplateDescriptor` via contracts | **justified** |
| `interaction`/`templates` build scripts → contracts | build-time (`tsc -p ../../contracts/tsconfig.json` inside `packages/interaction/package.json` and `packages/templates/package.json` `build:contracts`) | — | **accidental** — packages secretly rebuild a foreign package; belongs in `scripts/build-all.sh` ordering only |

Net shape: a clean star (contracts at the center) plus `runtime` as the only fan-in orchestrator, plus root. The **architecture is sound**; the problems are duplicated declarations of the seams (SceneIR, theme helpers), divergent build mechanics, and export-name collisions.

---

## 2. Findings

### 2.1 Inconsistencies

- **I1 — Divergent `paths` mapping for `@lumen/contracts`.** `packages/kernel/tsconfig.json` and `packages/build/tsconfig.json` map to `contracts/dist/index.d.ts`; `scene`, `rendering`, `assets`, `interaction`, `templates`, `config`, `codegen` map to `contracts/src/index.ts`; `packages/interaction/tsconfig.build.json` maps to **both** (`["../../contracts/dist/index.d.ts", "../../contracts/src/index.ts"]`). Two resolution strategies for the same package.
- **I2 — Divergent dist layouts.** Flat `dist/index.js`: contracts, kernel, interaction, templates, build, runtime. Deep `dist/packages/<pkg>/src/index.js` (caused by `rootDir: "../.."` + including contracts sources): scene, config, codegen, assets (see `packages/scene/package.json` `main: "./dist/packages/scene/src/index.js"` vs `packages/kernel/package.json` `main: "./dist/index.js"`). The deep layout exists only so `paths` can point at `contracts/src` — I1 and I2 are the same root cause.
- **I3 — package.json entry drift.** `rendering` and `assets` set `main`/`types`/`exports` to **`./src/index.ts`** (shipping TypeScript source as the entry) while every other package points at `dist`. `rendering` has no `files` field and no `license`; `assets` ships `files: ["src"]`.
- **I4 — Per-package build pattern drift.** `assets`, `interaction`, `templates` carry a second `tsconfig.build.json`; the other seven packages build from `tsconfig.json` directly. `assets/tsconfig.json` is `noEmit` + `declaration:false` (typecheck-only) while `config`/`codegen`/`scene` emit from the same file. `build` alone has `tsconfig.test.json` (compiles `.ts` tests to `dist-test/`) while all other packages use `.mjs` tests against `dist`. `scripts` blocks diverge (`typecheck` present in some, absent in kernel; `private: true` on interaction/config/codegen only; `license: MIT` vs `UNLICENSED` vs missing).
- **I5 — Contracts built by dependents.** `interaction` and `templates` `build` scripts invoke `tsc -p ../../contracts/tsconfig.json` (see boundary map). Hidden build-order dependency; `scripts/build-all.sh` already owns ordering.
- **I6 — Naming drift: boot vs start.** `packages/kernel/src/kernel.ts:46` exposes `boot()` as "Alias of start() (contract naming)"; runtime exposes `bootEngine()`; root `createEngine().boot()`. Three names for the same concept. (Contract `KernelHandle` name frozen → keep both, document one.)
- **I7 — CSS-variable naming drift (worst user-visible inconsistency).** `templates/src/theme.ts` `toCssVariables()` emits `--lumen-color-*`, `--lumen-type-*`, `--lumen-space-*`, `--lumen-duration-*`, `--lumen-ease-*`. `codegen/src/common.ts:137` `themeToCssVars()` emits `--<name>`, `--type-*`, `--spacing-*`, `--duration-*` (no `lumen` prefix, `spacing` vs `space`, **no easing vars at all**). SSR HTML from codegen and DOM theming from templates disagree on the variable names for the *same* tokens.
- **I8 — Shim/layout duplication.** `scripts/link-workspaces.mjs` `ENTRIES` table and root `tsconfig.build.json` `paths` each hardcode all 11 packages' entry layouts (including the deep `dist/packages/...` paths). Any layout change must be made in three places (package.json, link script, root tsconfig).

### 2.2 Duplication

- **D1 — Theme merge.** `codegen/src/ir.ts` `mergeTheme()` (+ local `mergeRecords`) re-implements `templates/src/theme.ts` `resolveThemeTokens()` (+ its own `mergeRecords`). Same semantics (per-key merge for colors/typeScale/spacing/motion.duration, atomic replace for motion.standard/emphasized), two copies.
- **D2 — CSS-var emission.** `codegen/src/common.ts` `themeToCssVars()` duplicates `templates/src/theme.ts` `toCssVariables()/toCssVariablesString()` — with drifted names (I7).
- **D3 — Manifest helpers.** `runtime/src/ir.ts` `manifestFromAssetRefs()` synthesizes manifest entries per kind (image/video/model/font/lottie/audio switch), overlapping `assets/src/manifest.ts` (`normalizeManifest`, `isAssetManifest`, `resolveAssetUrl`, `primaryUrl`). Two places know the per-kind `AssetEntry` shape.
- **D4 — SceneIR declared twice.** `codegen/src/ir.ts` and `runtime/src/ir.ts` both declare `SCENE_IR_VERSION`, `SceneIR`, `IRNode`, `IRTrack`, `IRAssetRef` (runtime's header comment says "deliberately structural"). Plus the inverse pair `lowerNode`/`raiseNode`. Any schema change needs four coordinated edits. Root `index.ts` proves the collision: it aliases `SceneIR as RuntimeSceneIR`, `IRNode as RuntimeIRNode`, etc.
- **D5 — Validator-ish checks in three layers.** `config/src/schema.ts:178` (duplicate id detection), `templates/src/internal.ts` `assembleScene()` (duplicate node/track ids, unknown track/binding targets), `templates/src/registry.ts` `validate()` (slot/intersection checks). `assembleScene`'s structural invariants partially re-check what schema validation already guarantees.
- **D6 — Easing/bezier knowledge in three places.** `config/src/schema.ts:62` (cubic-bezier tuple validation), `scene/src/timeline.ts` (`cubicBezierEase`, `applyEasing`), `templates/src/theme.ts` (bezier → `cubic-bezier()` string formatting). Acceptable layering, but the string formatter belongs next to D2's single home.
- **D7 — compose means two things.** `scene/src/compose.ts` exports `createSceneRuntime`/`evaluate` (no `compose`); `templates` descriptors own `compose()`. File named `compose.ts` in scene contains scene *instantiation*, not composition.

### 2.3 Unclear responsibilities

- **U1 — SceneIR ownership.** The codegen→runtime handshake document has no owner: producer-typed in codegen, consumer-typed in runtime, referenced by name in generated code. It is a cross-module contract by SPEC's own definition and belongs in `contracts/` (or a dedicated IR home).
- **U2 — interaction doing navigation semantics.** `interaction/src/manager.ts` `InteractionManagerOptions.onNavigate` receives `'next'/'prev'`, documented as "the Kernel wires this to its event bus"; `runtime/src/engine.ts:273` then maps it to `bus.emit('scene:next'|'scene:prev')`. Interaction should emit raw step events; navigation event naming is kernel/runtime territory. (Low harm, but a leaked responsibility.)
- **U3 — runtime adapter encoding renderer conventions.** `runtime/src/engine.ts` `toDrawCall()` (≈lines 140–180) hardcodes the DomRenderer payload decoding (`{kind, html?, assetId?, rect, opacity?, transform?, visible?}`) and the WebGL mesh convention, with a comment admitting "Payload conventions follow the DomRenderer decoding documented in @lumen/rendering". The WorldState→DrawCall mapping is rendering's knowledge living in runtime.
- **U4 — config exports a public validator toolkit.** `config/src/index.ts` exports `object/string/number/boolean/enumOf/array/optional/union/tuple/recordOf/isRecord/joinPath/InferObject/ObjectSpec/Validator/ValidationError/ValidationResult` — a zod-mini. Only `schema.ts` needs it; exporting it enlarges the frozen surface and caused the `ValidationResult` name collision with templates.

### 2.4 Coupling hotspots

- **H1 — Root `index.ts` cherry-picking.** Root must hand-list exports for `templates`, `config`, and `runtime` because of two collisions: `ValidationResult` (templates/registry vs config/validate) and `SceneIR`/`IRNode`/`IRTrack`/`IRAssetRef`/`SCENE_IR_VERSION` (codegen/ir vs runtime/ir, aliased `RuntimeSceneIR`…). Every new colliding export silently drops out of the public surface or breaks the root build. This is the clearest symptom that D4/U4 need fixing.
- **H2 — runtime↔rendering payload convention leak** (U3): changing `renderer-dom.ts` payload decoding requires editing `runtime/src/engine.ts` — cross-package implicit contract.
- **H3 — Layout knowledge in three places** (I8): package.json `exports`, `scripts/link-workspaces.mjs`, root `tsconfig.build.json` paths.
- **H4 — `examples/simple-site/dist/` is checked in** (`index.html`, hashed `main.*.js`, manifests). Regeneration on build changes creates noisy diffs; harmless but note it when I7 lands (SSR CSS changes).

---

## 3. Proposed refactored structure

Keep all 11 packages and every capability. The refactor is: one build convention, one owner per shared concern, a narrower export surface.

### Change list (ranked by value/effort)

**C1 — [MUST] Unified build convention. Risk: medium (build mechanics), value: very high. Fixes I1–I5, I8, H3.**
Target convention for *every* package (contracts and all of `packages/*`):
- `tsconfig.json` = the only build config: `extends ../../tsconfig.base.json`, `rootDir: "src"`, `outDir: "dist"`, `composite: false`, `include: ["src"]`, `paths: { "@lumen/contracts": ["../../contracts/dist/index.d.ts"] }` (contracts itself: no paths). Everyone resolves contracts against **dist**, never src. Remove the `"include": ["../../contracts/src/**/*.ts"]` in rendering.
- Delete `packages/assets/tsconfig.build.json`, `packages/interaction/tsconfig.build.json`, `packages/templates/tsconfig.build.json`, and the `build:contracts` script + contracts rebuild inside `interaction`/`templates` `build` scripts. Build order (contracts first) lives solely in `scripts/build-all.sh`.
- Every package.json: `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, `"files": ["dist", "README.md"]`, uniform scripts `{ "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "npm run build && node --test test/" }`, `"license": "UNLICENSED"` (repo is private) — fix rendering and assets (currently pointing at `./src/index.ts`, I3).
- Simplify `scripts/link-workspaces.mjs` `ENTRIES` to a loop: every package is `<dir>/dist/index.js` (delete the hardcoded deep paths for scene/config/codegen/assets/rendering).
- Simplify root `tsconfig.build.json` `paths` to uniform `["<dir>/dist/index.d.ts"]`.
- Keep `packages/build/tsconfig.test.json` (its `.ts` tests legitimately differ) but rename its outDir convention unchanged; document it in build/README as the one sanctioned exception. Convert nothing else.
- Verification: `bash scripts/build-all.sh && node scripts/link-workspaces.mjs && npm run typecheck && npm test` plus each package's own `npm test`. No source `.ts` logic changes required except import resolution — tests run against dist, so if the build passes, tests pass.

**C2 — [MUST] Single owner for SceneIR. Risk: low–medium, value: high. Fixes D4, U1, half of H1.**
- Move `SceneIR`, `IRNode`, `IRTrack`, `IRBinding`, `IRAssetRef`, `SCENE_IR_VERSION` into **new `contracts/src/ir.ts`** (re-exported from `contracts/src/index.ts`). Additive change to contracts; does not rename or alter any existing frozen type. Justification: SPEC rule 1 says all cross-module types live in contracts — SceneIR is one (it crosses codegen → generated code → runtime).
- `codegen/src/ir.ts`: keep `lowerToIR`, `serializeIR`, `walkIR` (behavior), re-export the IR types from contracts for source compatibility.
- `runtime/src/ir.ts`: delete the structural re-declarations; import IR types from contracts. Keep `isSceneIR`, `composedSceneFromIR`, `manifestFromAssetRefs` (runtime behavior) here. `runtime/src/index.ts` re-exports the contracts types so `import { SceneIR } from '@lumen/runtime'` keeps working.
- Because codegen and runtime now export the *same* `SceneIR` symbol, root `index.ts` drops the `RuntimeSceneIR`/`RuntimeIRNode`/`RuntimeIRTrack`/`RuntimeIRAssetRef` aliases — one re-export wins; pick codegen's via `export *` and list runtime's behavior functions explicitly (see C6).
- Note in SPEC/docs that contracts gains `ir.ts` (docs/api-index.md row for contracts).

**C3 — [MUST] One home for theme helpers. Risk: low–medium (SSR output text changes), value: high. Fixes D1, D2, I7.**
- `templates/src/theme.ts` is the single home for: `resolveThemeTokens`, `toCssVariables`, `toCssVariablesString`, `defaultTypeScale/Spacing/Motion`, and the internal `mergeRecords`.
- `codegen/src/ir.ts` `mergeTheme()` → delete; `lowerToIR` calls `resolveThemeTokens(defaults, config.theme)` (signatures already align: codegen's `over: EngineConfig['theme']` is assignable to `Partial<ThemeTokens>`).
- `codegen/src/common.ts` `themeToCssVars()` → delete; `criticalCss(theme)` calls `toCssVariablesString(theme)` from `@lumen/templates`. Add `@lumen/templates` as a real dependency of codegen (value import). This is a deliberate new edge codegen→templates — justified: codegen already consumes `TemplateDescriptor` objects produced by templates; sharing its theme emitter removes drift. Alternative considered (helpers in contracts): rejected, contracts stays types-only per SPEC.
- **Deliberate behavior change:** SSR/critical CSS switches to the `--lumen-*` naming (templates' convention, which is the one covered by `packages/templates/test/theme.test.mjs` and the runtime DOM path). No test asserts codegen's old `--type-*`/`--spacing-*` names (verified: grep over `tests/e2e` and all package tests). Regenerate `examples/simple-site/dist/` and note H4 in the commit.

**C4 — [MUST] Resolve the `ValidationResult` collision. Risk: low, value: medium. Fixes rest of H1, U4.**
- Rename templates' `ValidationResult`/`ValidationWarning` → `TemplateValidationResult`/`TemplateValidationWarning` in `templates/src/registry.ts` and `templates/src/index.ts`. (grep confirms the only consumers are templates tests + registry itself; root index.ts doesn't re-export them today.)
- Stop exporting the validator combinators from `config/src/index.ts`: keep `parseConfig`, `stripJsonComments`, `validateConfig`, `engineConfigSchema`, `CONFIG_VERSION`, `applyDefaults`, `deepMerge`, `DEFAULT_*`, `migrate`, `migrations`, and the *types* `ParseConfigResult`, `ConfigValidationOutcome`, `MigrationResult`, `ValidationError`. Move combinators' export to a documented internal module `config/src/validate.js` (still importable directly, just not from the package root). Check first: `grep -rn "from '@lumen/config'" packages/*/test` — if a test imports combinators from the package root, keep `isRecord`/`joinPath` (the plausibly useful two) and drop the rest.

**C5 — [MUST] Root `index.ts` export-surface cleanup. Risk: low, value: medium. Depends on C2+C4.**
After C2/C4 there are no collisions left, so root becomes:
```ts
export * from '@lumen/contracts';
export * from '@lumen/kernel';
export * from '@lumen/scene';
export * from '@lumen/rendering';
export * from '@lumen/assets';
export * from '@lumen/interaction';
export * from '@lumen/templates';   // full surface again (incl. theme helpers, registry)
export { parseConfig, stripJsonComments, validateConfig, engineConfigSchema, CONFIG_VERSION,
         applyDefaults, deepMerge, DEFAULT_BUILD, DEFAULT_PRELOAD_BY_KIND, DEFAULT_THEME_TOKENS,
         migrate, migrations } from '@lumen/config';
export type { ParseConfigResult, ConfigValidationOutcome, MigrationResult, ValidationError } from '@lumen/config';
export * from '@lumen/codegen';
export * from '@lumen/build';
export { bootEngine, hydrateIslands, parseSceneIR, asKernelHandle,
         composedSceneFromIR, isSceneIR, manifestFromAssetRefs } from '@lumen/runtime';
export type { BootOptions, LumenEngine } from '@lumen/runtime';
```
(`config` and `runtime` stay explicit — config to hide combinators, runtime to avoid double-exporting the now-shared IR types that already come via codegen/contracts. No `as`-aliases anywhere.) Add a one-line comment over each explicit block explaining why it is explicit, so it doesn't regress into symptom H1.

**C6 — [OPT] Move the WorldState→DrawCall adapter into rendering. Risk: medium, value: medium. Fixes U3/H2.**
- Export `drawCallsFromWorldState(world: WorldState, opts?): DrawCall[]` from `@lumen/rendering` (new file `packages/rendering/src/frame-adapter.ts`), moving `nodeOpacity`, `cssTransform`, `toDrawCall` and the payload-convention comment out of `runtime/src/engine.ts`. Rendering owns the payload decoding; runtime keeps only orchestration. Requires rendering to import the `WorldState` *type* from `@lumen/scene` (type-only edge rendering→scene; acceptable) — or define the entry shape structurally in contracts/rendering.ts. If the type edge feels wrong, skip C6 entirely; it is optional.

**C7 — [OPT] Navigation hook cleanup. Risk: low, value: low. Fixes U2.**
- Keep `InteractionManagerOptions.onNavigate` (public API, used by tests) but change its docs: it emits step-navigation *intent*; runtime's wiring at `engine.ts:273` stays the sole place mapping intent → `scene:next`/`scene:prev` bus events. No code move needed beyond comment + README clarification. Renaming the option is **not** worth it (see Do-NOT).

**C8 — [OPT] Naming/doc alignment. Risk: trivial. Fixes I6, D7 cosmetically.**
- Rename `scene/src/compose.ts` → `scene/src/runtime.ts` (it exports `SceneRuntime`/`evaluate`; "compose" belongs to templates). Pure file rename; `scene/src/index.ts` import path updates. Public symbols unchanged.
- `kernel/src/kernel.ts`: keep both `start()` and `boot()` (contract name frozen), but mark `boot()` `@deprecated` in JSDoc pointing at `start()`.
- README sweep: each package README must state responsibilities, public symbols, and the build convention (one paragraph, same template). Align `docs/api-index.md` with C2/C4/C5 changes.

**C9 — [OPT] Collapse triple validation. Risk: medium, value: low. Fixes D5.**
- Keep `config/schema.ts` (input validation) and `registry.validate()` (template-slot warnings) as-is. In `templates/src/internal.ts` `assembleScene()`, downgrade the duplicate-id/unknown-target throws to a dev-mode invariant comment or a single `debugAssert` — the checks are unreachable for any config that passed `parseConfig` + `registry.validate`. Only do this if a templates test doesn't assert those exact throw messages (check `packages/templates/test/*.mjs` first; if asserted, skip C9).

### Sequencing (one pass, dependency order)

1. **C1 build convention** (no logic changes; everything else builds on the uniform layout). Independently executable.
2. **C2 SceneIR → contracts** (needs C1 so new contracts/dist is uniformly resolvable).
3. **C3 theme helpers** (independent of C2; needs C1 for the new codegen→templates edge to resolve via dist).
4. **C4 renames** (independent).
5. **C5 root index.ts** (depends on C2+C4).
6. **C6–C9 optional, any order, after C1.**
7. Final: `bash scripts/build-all.sh && node scripts/link-workspaces.mjs && npm run typecheck && npm test`, then run every package's `npm test`, then regenerate `examples/simple-site/dist/` via `npm run example` (SSR CSS var names changed by C3; hashed filenames will churn — expected, H4).

### Validation checklist for the coder

- `npm run typecheck` (root) clean.
- `node --test tests/e2e/` green (run build-all + link first).
- Each `packages/*/npm test` green (kernel, scene, rendering, assets, interaction, templates, config, codegen, build).
- `node examples/simple-site/build-example.mjs` regenerates the example; eyeball that `dist/index.html` now contains `--lumen-color-` (not `--color-`/`--spacing-`).
- Root smoke: `node -e "import('./dist/index.js').then(m => { for (const k of ['createEngine','parseConfig','bootEngine','generate','build','createDefaultRegistry','resolveThemeTokens','lowerToIR','composedSceneFromIR','manifestFromAssetRefs']) if (!(k in m)) throw new Error('missing '+k); })"`.

---

## 4. Do-NOT list (must stay stable)

1. **Frozen contract type names** in `contracts/src/*.ts` — `EngineConfig`, `SceneConfig`, `SceneNodeConfig`, `AssetRef`, `InteractionConfig`, `ConfigMigration`, `TemplateKind`, `TemplateDescriptor`, `SlotDefinition`, `ThemeTokens`, `ModuleRequirement`, `PerformanceBudget`, `KernelHandle`, `KernelContext`, `LumenPlugin`, `LifecyclePhase` (incl. phase names `created→booting→loading→ready→active→paused→disposed`), `EngineEventMap` (incl. event names `scene:next`, `scene:prev`, `asset:progress`, `engine:error`, `lifecycle:enter/leave/change`), `EngineError`, `CapabilityProfile`, `BudgetReport`, `IRenderer`, `RenderFrame`, `DrawCall`, `FrameStats`, `CameraState`, `QualityLevel`, `RendererBackend`, `TextureAsset`, `SceneNode`, `Transform`, `TimelineTrack`, `Keyframe`, `PropertyBinding`, `ComposedScene`, `AssetManifest`, `AssetEntry`, `AssetKind`, `LoadState`, `PreloadStrategy`, `NormalizedInputEvent`, `InteractionBinding`, `InputSource`, `GestureType`, `A11yFallback`, `VirtualScroller`, `SmoothingConfig`, `CodegenTarget`, `CodegenOptions`, `CodegenResult`, `BuildArtifact`, `BuildOptions`, `SizeBudget`. Additive only (C2 adds `ir.ts`).
2. **Package names** `@lumen/*` and the 11-package layout (SPEC-governed; agents own directories).
3. **Public API names** used in tests/docs: `parseConfig`, `validateConfig`, `applyDefaults`, `migrate`, `createDefaultRegistry`, `TemplateRegistry` (methods `get/require/register/list/kinds/validate/capabilities`), descriptor `.compose()`, the four template export names + `*_SLOTS` / `*_THEME_DEFAULTS`, `resolveThemeTokens`, `toCssVariables(String)`, `generate`, `generateStatic/WebComponent/Runtime/Npm`, `lowerToIR`, `serializeIR`, `build`, `buildAll`, `bootEngine`, `hydrateIslands`, `parseSceneIR`, `manifestFromAssetRefs`, `composedSceneFromIR`, `isSceneIR`, `createEngine`, `EngineDescriptor.boot()/build()`.
4. **SceneIR wire format**: `version: 1` and the JSON shape (`site/template/theme/nodes/tracks/bindings/assets/hydration/a11y`). Moving its declaration (C2) must not change emitted JSON — generated bundles and `parseSceneIR`/`isSceneIR` behavior stay byte-compatible.
5. **Generated-module API contracts** that codegen emits and tests assert: `bootEngine(root, ir)`, `hydrateIslands(engine, islands)`, `sceneIR` export (npm target), `loadLumen(configUrl, root?)` (runtime target), `<lumen-embed>` custom element name, entry filenames (`lumen-embed.ts`), `hydration-manifest.json` filename, `RUNTIME_SPECIFIER = '@lumen/runtime'` import in generated code, `id="lumen-root"` in SSR HTML (asserted in `tests/e2e/smoke.test.mjs:93,128`).
6. **Build artifact behaviors**: hashed filenames (`HASH_LENGTH`), budget report formats (`formatReportText/Json`), `DeployManifest`, `buildAll` per-target subdirectories.
7. **`--lumen-*` CSS variable names in `templates/theme.ts`** (asserted by `packages/templates/test/theme.test.mjs`) — these become the *single* convention; codegen's unprefixed names are the side that changes.
8. **Kernel dual name `start()`/`boot()`** — do not delete either (contract naming); deprecate in docs only (C8).
9. **`InteractionManagerOptions.onNavigate`** option name and `'next'|'prev'` payload (used by runtime + manager tests).
10. **Test invocation pattern**: `node --test test/` against compiled dist per package; `node --test tests/e2e/` at root; `scripts/link-workspaces.mjs` shim approach (mount can't symlink) — only its internal table simplifies.
11. **Zero required runtime deps** for kernel/scene/config/contracts; `three` stays an optional peer of rendering behind dynamic import.
12. **`SPEC.md` sacred rules** themselves; update SPEC/docs text where structure changed (contracts gains `ir.ts`, build convention section), but do not relax the ownership rules.
