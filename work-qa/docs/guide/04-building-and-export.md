# 04 — Building and Exporting

This guide turns a validated config into deployable artifacts: the four
export targets, the build script you write, budgets, and the output layout.

## Prerequisites

From the repository root:

```sh
npm install            # npm workspaces: contracts/ + packages/*
npm run build          # scripts/build-all.sh
```

`scripts/build-all.sh` compiles contracts first, then every package in
dependency order, then `@lumen/runtime` and the root entry, and finally runs
`scripts/link-workspaces.mjs` to (re)create the `node_modules/@lumen/*`
shims (real directories, not symlinks — this mount cannot create symlinks).

**TypeScript discovery.** The script finds `tsc.js` in this order:

1. `$LUMEN_TSCJS` (explicit path — set this if the others don't exist),
2. `<root>/node_modules/typescript/lib/tsc.js`,
3. `$HOME/tools/typescript/lib/tsc.js`.

If none exists: `export LUMEN_TSCJS=/path/to/typescript/lib/tsc.js`.
`@types/node` (needed by `@lumen/build`) is auto-provisioned from
`$HOME/tools/@types/node` when the root `node_modules` copy is missing.

Sanity check after building:

```sh
node --test tests/e2e/     # e2e smoke tests (npm test)
```

## The four export targets

Set in `config.build.target` (or overridden per build call):

| Target         | Emits                                                        | Use it when |
| -------------- | ------------------------------------------------------------ | ----------- |
| `static`       | `index.html` (SSR shell + `<noscript>` fallback) + hashed `main.*.js` boot module + `manifest.json` | Deploying a standalone site to any static host. The default choice. |
| `webcomponent` | Hashed `lumen-embed.*.js` defining a `<lumen-embed>` custom element + `manifest.json` | Embedding a Lumen experience inside an existing page or CMS. |
| `npm`          | Unhashed `index.js` ESM library entry + `index.d.ts` type declarations + `manifest.json` | Publishing a reusable package; consumers call the exported `bootEngine`. |
| `runtime`      | Hashed `loader.*.js` that fetches a config JSON by URL and boots it + `manifest.json` | Serving many configs through one loader (config-as-data). |

When your scene has hydration islands, codegen also emits
`hydration-manifest.json` (content-hashed on targets that hash).

## A complete build script

This is the same pipeline as `examples/simple-site/build-example.mjs`:

```js
// build-site.mjs — run with: node build-site.mjs
import { readFileSync } from 'node:fs';

import { parseConfig } from '@lumen/config';
import { createDefaultRegistry } from '@lumen/templates';
import { generate } from '@lumen/codegen';
import { build } from '@lumen/build';
import { manifestFromAssetRefs } from '@lumen/runtime';

// 1. Parse + validate (migrations and defaults applied).
const parsed = parseConfig(readFileSync('./lumen.config.jsonc', 'utf8'));
if (!parsed.ok) {
  for (const e of parsed.errors) console.error(`${e.path}: ${e.message}`);
  process.exit(1);
}
const config = parsed.config;

// 2. Template lookup, slot validation (warnings only), composition.
const registry = createDefaultRegistry();
const { warnings } = registry.validate(config);
for (const w of warnings) console.warn(`template warning: ${w.path}: ${w.message}`);
const descriptor = registry.require(config.template);
const manifest = manifestFromAssetRefs(config.assets);
const scene = descriptor.compose(config, manifest);

// 3. Codegen + build pipeline. @lumen/build never imports codegen itself —
//    you inject generate().
const artifact = await build(
  {
    target: config.build,                 // { target, minify, ssr, moduleFormat }
    outDir: 'dist/site',
    strictBudgets: process.env.CI === 'true',
    onReport: (text) => console.log(text),
  },
  (options) => generate(config, descriptor, scene, options),
);

console.log('entry:', artifact.entry);
console.log('budgets passed:', artifact.budgets.passed);
```

Serve the result with any static file server: `npx serve dist/site`.

> Prefer one call instead? `createEngine(configInput, { onReport })` from the
> root package wraps steps 1–2 and gives you `engine.build({ outDir })`. The
> explicit form above is what you want in a real build script — you can
> inject your own registry, manifest, budgets, and minify hooks.

## BuildOptions / BuildConfig reference

`build(config, generateFn, overrides?)` — `BuildConfig` fields:

| Field             | Type                  | Default | Meaning |
| ----------------- | --------------------- | ------- | ------- |
| `target`          | `CodegenTarget`       | —       | Required: `{ target, minify?, ssr?, moduleFormat? }`. |
| `outDir`          | `string`              | —       | Required: output directory for this target. |
| `budgets`         | `SizeBudget[]`        | architecture budgets | Budgets to enforce (see below). |
| `strictBudgets`   | `boolean`             | `false` | Throw when any budget fails (CI mode). |
| `minifyHooks`     | `MinifyHook[]`        | `[]`    | `(content, path) => content` transforms applied in the optimize phase when `target.minify !== false`. |
| `sourcemaps`      | `boolean`             | `false` | Emit `*.map` companions / pass through to codegen. |
| `measuredMetrics` | `{ 'first-frame-ms'?, 'lighthouse-a11y'? }` | — | Externally measured runtime metrics to include in budget checks. |
| `environment`     | `string`              | `'local'` | Marker in the report (e.g. `'ci'`). |
| `clean`           | `boolean`             | `true`  | Remove stale files from previous builds of the same outDir. |
| `onReport`        | `(text) => void`      | —       | Sink for the human-readable report. |

`buildAll(options, generateFn)` runs several targets sequentially, each into
its own subdirectory: `<outDir>/<target>/`.

## The pipeline phases

`build()` runs six timed phases (timings land in the report):

```
validate ─▶ generate ─▶ optimize ─▶ hash ─▶ emit ─▶ report
```

1. **validate** — target kind, outDir, moduleFormat sanity.
2. **generate** — calls your injected `generate()` codegen function.
3. **optimize** — runs `minifyHooks` over JS/CSS/HTML/JSON files (skipped
   when `target.minify === false` or no hooks are registered).
4. **hash** — SHA-256 content-addressed filenames plus specifier rewriting
   inside emitted JS/HTML (e.g. `main.js` → `main.6241a3aadf.js`, and the
   `<script src>` in `index.html` updated).
5. **emit** — writes files, materializes `manifest.json`, cleans stale files.
6. **report** — gzip measurements, budget evaluation, report text/JSON.

## Budgets

Each budget is `{ metric, budget }`. Metrics:

| Metric             | Measured from files? | Meaning |
| ------------------ | -------------------- | ------- |
| `js-gz`            | yes                  | Sum of gzip bytes across all `.js`/`.mjs` files. Default ≤ 170 KB. |
| `css-gz`           | yes                  | Sum of gzip bytes across `.css` files. Default ≤ 40 KB. |
| `critical-assets`  | yes                  | Raw bytes across asset-role files. Default ≤ 1.2 MB. |
| `first-frame-ms`   | no                   | Checked only when supplied via `measuredMetrics`, else reported as *skipped*. |
| `lighthouse-a11y`  | no                   | Score (higher is better); also needs `measuredMetrics`. |

Statuses: **pass** within budget, **warn** over budget but within the warn
tolerance (+10% by default), **fail** beyond it. Gzip sizes are measured with
`node:zlib` (`gzipSync`, level 9) — deterministic and offline.

When a budget **fails**: with `strictBudgets: false` (default) the build
succeeds and the failure shows up in the report (`artifact.budgets.passed ===
false`); with `strictBudgets: true` the build throws
`build: size budgets failed (strictBudgets) — <metric>: <actual> > <budget>`.

To tighten budgets per project:

```js
await build({
  target: config.build,
  outDir: 'dist/site',
  budgets: [{ metric: 'js-gz', budget: 120 * 1024 }],
  strictBudgets: true,
}, generateFn);
```

## Reading the build report

Two forms:

- **Text** — delivered to `onReport`, e.g. phase timings, per-file sizes,
  budget outcomes, codegen warnings (like unused assets or missing a11y
  metadata).
- **Structured** — `artifact.budgets` (`BuildBudgetReport`:
  `{ passed, checks: [{ metric, budget, actual }] }`) and `artifact.report`
  (a JSON record with timings, warnings, environment, …) for CI logs.

`manifest.json` in the outDir is the deploy manifest:

```json
{
  "target": "static",
  "entry": "index.html",
  "files": [
    { "path": "main.6241a3aadf.js", "bytes": 4896, "gzipBytes": 1490,
      "hash": "6241a3aadf", "role": "entry" }
  ],
  "generatedAt": "2026-08-25T11:01:46.089Z"
}
```

## Output layout (static target)

```
dist/site/
├── index.html                            # SSR shell (role: ssr, never hashed)
├── main.<hash>.js                        # boot module (role: entry)
├── hydration-manifest.<hash>.json        # only when islands exist
└── manifest.json                         # deploy manifest
```

Codegen only emits text modules — your media files are referenced by URL
from the SceneIR, not copied into `dist/`; host them yourself (the example
uses remote URLs). The `npm` target skips filename hashing and adds
`index.d.ts`. File roles are `entry | chunk | asset | ssr | worker`; the
`hydration-manifest.json` is classified `asset` by filename.

## Next steps

- [05 — Worked example: scroll-video](05-example-scroll-video.md) — run this
  end to end on the checked-in example, with expected output.
