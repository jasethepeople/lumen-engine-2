# @lumen/build

Build/export pipeline for the Lumen engine. Orchestrates `CodegenResult` files
through a phased pipeline and emits content-addressed, budget-gated
`BuildArtifact`s for the four export targets (`static`, `webcomponent`,
`npm`, `runtime`).

Node-oriented (Node >= 18, `node:fs` / `node:crypto` / `node:zlib`), strict
TypeScript, ESM, zero runtime dependencies. Minification is a pluggable hook —
this package has no bundler dependency.

## Responsibilities

- Run the build phases: **validate → generate → optimize → hash → emit → report**.
- Inject codegen as a dependency: `build(config, generate)` receives a
  `generate()` matching the `CodegenOptions → CodegenResult` contract
  signature. `@lumen/build` never imports `@lumen/codegen` directly; the
  Integration layer wires the two together.
- Content-hash emitted filenames (SHA-256, truncated) and rewrite quoted
  import specifiers inside emitted JS/HTML over the known import graph
  (simple, documented string replacement — not full JS parsing; see
  `src/hash.ts`).
- Emit per-target layouts plus a `manifest.json` deploy manifest, and clean
  files left over from previous builds of the same target.
- Enforce size budgets: deterministic gzip measurement via `node:zlib`,
  per-metric pass/warn/fail, aggregate `BuildBudgetReport` (CI PR-comment
  JSON), `strictBudgets` mode to fail the build. Defaults come from the
  architecture budgets (170 KB gz JS, 1.2 MB critical assets, …).

## Pipeline phases

| Phase     | What happens |
|-----------|--------------|
| validate  | Target descriptor and options are sanity-checked. |
| generate  | Injected `generate()` produces a `CodegenResult`. |
| optimize  | Minify hooks run (when `target.minify !== false`). |
| hash      | Files are renamed to `name.<hash>.ext`; JS/HTML specifiers rewritten. |
| emit      | Files written to `outDir`, `manifest.json` materialized, stale files removed. |
| report    | gzip sizes measured, budgets evaluated, text + JSON reports produced. |

Every phase is timed; timings land in the report.

## Usage

```ts
import { build } from '@lumen/build';
import { generate } from '@lumen/codegen'; // wired by Integration

const artifact = await build(
  {
    target: { target: 'static', minify: true, ssr: true },
    outDir: 'dist/site',
    strictBudgets: process.env.CI === 'true',
    minifyHooks: [myEsbuildMinify], // optional pluggable minifier
    onReport: (text) => console.log(text),
  },
  generate,
);

console.log(artifact.entry, artifact.budgets.passed);
```

Multi-target invocation (one subdirectory per target under `outDir`):

```ts
import { buildAll } from '@lumen/build';

const artifacts = await buildAll(
  { targets: [{ target: 'static' }, { target: 'runtime' }], outDir: 'dist' },
  generate,
);
```

Runtime metrics that cannot be measured from files (`first-frame-ms`,
`lighthouse-a11y`) are reported as *skipped* unless supplied via
`measuredMetrics` (e.g. from a Lighthouse run in CI).

## Collaboration notes

- **Contracts**: consumes `@lumen/contracts` only (`CodegenResult`,
  `BuildArtifact`, `SizeBudget`, …). No contract gaps were found; no local
  adapters needed.
- **Codegen**: injected via the `GenerateFn` signature — Integration imports
  `@lumen/codegen`'s `generate()` and passes it to `build()`/`buildAll()`.
- **Config**: config validation happens upstream; `@lumen/build` validates
  only the target descriptor it receives.
- **Budget baseline**: `BudgetCheck.deltaFromBaseline` is left unset (no
  baseline store yet); CI can diff successive JSON reports.

## Build convention

This package follows the engine-wide unified build convention (see the other
packages' READMEs), with one sanctioned exception: its tests are TypeScript,
compiled by `tsconfig.test.json` into `dist-test/` and run with
`node --test dist-test/test/` instead of the usual `.mjs`-against-`dist`
pattern. `tsconfig.test.json` is the only non-standard build config in the repo.
