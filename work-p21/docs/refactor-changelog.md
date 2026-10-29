# Refactor Changelog — `agent/refactor`

Record of the structure refactor specified in
[`refactor-proposal.md`](../refactor-proposal.md). No public API names or
frozen contract types were removed; the change set is consolidation of
duplicated seams plus one unified build convention.

## Findings summary (proposal §2)

- **Inconsistencies (I1–I8):** divergent `paths` resolution for
  `@lumen/contracts` (dist vs src), mixed flat/deep `dist/` layouts,
  package.json entry drift (`rendering`/`assets` pointed at `./src/index.ts`),
  per-package build-pattern drift (extra `tsconfig.build.json` files,
  dependents secretly rebuilding contracts), boot/start naming drift,
  codegen vs templates emitting *different CSS variable names* for the same
  theme tokens, and entry-layout knowledge hardcoded in three places
  (package.json, `link-workspaces.mjs`, root `tsconfig.build.json`).
- **Duplication (D1–D7):** theme merge and CSS-var emission implemented
  twice (codegen + templates), manifest helpers in runtime overlapping
  assets, `SceneIR` declared in both codegen and runtime, validator-ish
  checks repeated across three layers, easing knowledge in three places, and
  `compose` meaning two different things.
- **Unclear responsibilities (U1–U4):** SceneIR had no owner, interaction
  leaked navigation-event semantics, runtime hardcoded renderer payload
  conventions, and config exported a whole validator toolkit from its root.
- **Coupling hotspots (H1–H4):** root `index.ts` cherry-picked exports to
  dodge name collisions, runtime↔rendering implicit payload contract,
  layout knowledge in three places, checked-in example `dist/`.

## Changes applied

| # | Change | Result |
|---|--------|--------|
| C1 | **Unified build convention** | Every package: single `tsconfig.json` (`rootDir: "src"`, flat `dist/`, `@lumen/contracts` → `contracts/dist`), uniform `package.json` (`main`/`types`/`exports` → `./dist/index.*`, `files: ["dist", "README.md"]`, `build`/`typecheck`/`test` scripts, `license: UNLICENSED`). Deleted the three `tsconfig.build.json` files and the `build:contracts` scripts; build order lives solely in `scripts/build-all.sh`; `link-workspaces.mjs` `ENTRIES` is now a simple loop. `packages/build/tsconfig.test.json` kept as the one sanctioned exception. |
| C2 | **SceneIR owned by contracts** | New `contracts/src/ir.ts` owns `SceneIR`, `IRNode`, `IRTrack`, `IRBinding`, `IRAssetRef`, `SCENE_IR_VERSION` (additive; wire format unchanged). `codegen/src/ir.ts` keeps behavior (`lowerToIR`, `serializeIR`, `walkIR`) and re-exports the types; `runtime/src/ir.ts` deleted its structural re-declarations and imports them. |
| C3 | **One home for theme helpers** | `templates/src/theme.ts` is the single home (`resolveThemeTokens`, `toCssVariables(String)`). Codegen deleted `mergeTheme()`/`themeToCssVars()` and value-depends on `@lumen/templates` (new deliberate edge codegen→templates). |
| C4 | **`ValidationResult` collision resolved** | Templates renamed to `TemplateValidationResult`/`TemplateValidationWarning`; config stopped exporting validator combinators from the package root (they stay importable from the internal `validate.js` module). |
| C5 | **Root `index.ts` cleanup** | Mostly `export *`; two deliberate explicit blocks with explanatory comments: config (combinators hidden) and runtime (SceneIR types already arrive via contracts/codegen, so only behavior functions are listed). The `RuntimeSceneIR` etc. aliases are gone. |
| C6 | **Frame adapter in rendering** | New `packages/rendering/src/frame-adapter.ts` exports `drawCallsFromWorldState`/`drawCallForNode`; rendering owns the WorldState→DrawCall payload conventions (type-only edge rendering→scene for `WorldState`). Runtime keeps orchestration only. |
| C7 | **Navigation hook docs** | `InteractionManagerOptions.onNavigate` kept (frozen public API); documented as step-navigation *intent*, with `runtime/src/engine.ts` remaining the sole mapper to `scene:next`/`scene:prev` bus events. |
| C8 | **Naming/doc alignment** | `scene/src/compose.ts` renamed to `scene/src/runtime.ts` (public symbols unchanged); `kernel.boot()` marked `@deprecated` in favor of `start()` (both names kept — frozen contract). |
| C9 | **Validation layering** | `templates/src/internal.ts` `assembleScene()` structural invariants consolidated into a single `debugAssertStructuralInvariants()` pass. |

## Deliberate behavior change

- **SSR/critical CSS variable names** emitted by codegen switch to the
  templates convention: `--lumen-color-*`, `--lumen-type-*`,
  `--lumen-space-*`, `--lumen-duration-*`, `--lumen-ease-*` (previously
  unprefixed `--<name>`, `--spacing-*`, and no easing vars). No test
  asserted the old names; `examples/simple-site/dist/` was regenerated
  (checked-in output, expected churn — hotspot H4).

## Deviations from the proposal

- The codegen test (`packages/codegen/test/codegen.test.mjs`) was updated to
  assert the new `--lumen-*` SSR output.
- Known cosmetic issue: tokens whose config keys already carry a `color-`
  prefix (e.g. the `DEFAULT_THEME_TOKENS` keys `color-bg`, `color-fg` in
  `packages/config/src/defaults.ts`) emit as `--lumen-color-color-*`.
  Harmless (consistent, deterministic names); left as-is.
- C9 kept the invariant failures as `throw`s inside the consolidated
  `debugAssertStructuralInvariants()` helper rather than downgrading them to
  non-throwing debug assertions (tests assert the failure behavior).
- C6 was implemented (marked [OPT]); C7 was done as documentation only, as
  proposed.

## Verification

- `bash scripts/build-all.sh` (contracts → packages → runtime → root entry →
  workspace shims) compiles clean.
- `node --test tests/e2e/` and per-package `node --test test/` suites green.
- `node examples/simple-site/build-example.mjs` regenerates the example;
  `dist/index.html` now contains `--lumen-color-*` variables.
- Root smoke check: `createEngine`, `parseConfig`, `bootEngine`, `generate`,
  `build`, `createDefaultRegistry`, `resolveThemeTokens`, `lowerToIR`,
  `composedSceneFromIR`, `manifestFromAssetRefs` all present in the compiled
  root entry.
