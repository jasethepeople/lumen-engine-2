# Lumen Engine

Lumen is a TypeScript engine that turns a single declarative `EngineConfig`
into production-ready, high-performance interactive web frontends. You author
config (scenes, assets, interactions, theme); Lumen composes it through a
typed template, generates code for your chosen output target, and builds
content-hashed, budget-gated artifacts. At runtime a small kernel boots a
capability-aware renderer, scene graph, and interaction layer.

## The four frontend types

Every Lumen site is one of four template kinds (`TemplateKind`):

| Kind            | What it is                                                        | Primary driver |
| --------------- | ----------------------------------------------------------------- | -------------- |
| `scroll-video`  | Scroll-scrubbed full-bleed video with captions                      | scroll         |
| `cinematic-spa` | Sequenced, time-driven single-page experience (hero/gallery/outro) | time           |
| `viewer-3d`     | Orbital 3D model viewer with hotspots                               | pointer        |
| `storytelling`  | Long-form scrollytelling: blocks, media, sticky media             | scroll         |

See [docs/templates.md](docs/templates.md) for slots, capabilities, and
per-template config examples.

## Feature highlights

- **Declarative config** — one validated, versioned `EngineConfig` (JSON/JSONC)
  with migrations, defaults, and precise error paths (`@lumen/config`).
- **Typed templates** — templates are plain TypeScript modules
  (`TemplateDescriptor`), not string templating: fully type-checked and
  unit-testable (`@lumen/templates`).
- **Multi-target codegen** — emit a static site, a `<lumen-embed>` Web
  Component, an npm library, or a runtime JSON loader from the same config
  (`@lumen/codegen`).
- **Budget-gated builds** — content-hashed output, deploy manifest, and gzip
  size budgets that can fail CI (`@lumen/build`).
- **Adaptive rendering** — DOM, Canvas2D, WebGL2 (Three.js, optional peer)
  backends with automatic fallback and hysteresis-controlled adaptive quality
  (`@lumen/rendering`).
- **Deterministic interaction** — normalized input, gesture state machines,
  virtual scrolling, and reduced-motion/keyboard fallbacks
  (`@lumen/interaction`).
- **Zero-dependency core** — kernel, scene, config, and contracts run anywhere
  (Node, browsers, workers); DOM access is guarded.

## Architecture

```
            ┌──────────────────────────── build time ───────────────────────────┐
            │                                                                   │
 EngineConfig ──▶ @lumen/config      validate / migrate / defaults
      │              │ parseConfig
      │              ▼
      │        @lumen/templates    TemplateDescriptor.compose(config, manifest)
      │              │                    ──▶ ComposedScene
      │              ▼
      │        @lumen/codegen      SceneIR + per-target entry modules
      │              │ generate()       (static | webcomponent | npm | runtime)
      │              ▼
      │        @lumen/build        validate → generate → optimize → hash
      │              │ build()         → emit → report (budgets)
      │              ▼
      │        BuildArtifacts (content-hashed, manifest.json, budget report)
      │
      ▼            ┌──────────────────────────── runtime ───────────────────────┐
 browser    │                                                              │
            │   @lumen/kernel    lifecycle · event bus · scheduler ·        │
            │                    capabilities · plugins                      │
            │        │                                                     │
            │        ├──▶ @lumen/assets       manifest · preload · cache    │
            │        ├──▶ @lumen/scene        graph · timeline · bindings   │
            │        ├──▶ @lumen/interaction  input · gestures · scroll     │
            │        └──▶ @lumen/rendering    IRenderer + adaptive quality  │
            └──────────────────────────────────────────────────────────────┘
```

All cross-module types live in **`@lumen/contracts`** (`contracts/`) — frozen,
orchestrator-owned, dependency-free. Modules consume contracts; they never
define shared types locally. See [docs/architecture.md](docs/architecture.md).

## Quickstart

```sh
# 1. Install (npm workspaces: contracts/, packages/*, examples/*)
npm install

# 2. Build all packages (scripts/build-all.sh: contracts first, then packages
#    in dependency order, then @lumen/runtime + root entry, then workspace shims)
npm run build

# 3. Run the e2e smoke tests
npm test
```

Build a site from a config (Node ≥ 18):

```ts
// scripts/build-site.mjs
import { parseConfig } from '@lumen/config';
import { createDefaultRegistry } from '@lumen/templates';
import { generate } from '@lumen/codegen';
import { build } from '@lumen/build';
import { readFileSync } from 'node:fs';

const parsed = parseConfig(readFileSync('./lumen.config.jsonc', 'utf8'));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors, null, 2));

const registry = createDefaultRegistry();
const template = registry.get(parsed.config.template);
// AssetManifest pairs asset ids with built, content-hashed URLs;
// an empty manifest is fine for a first pass.
const manifest = { version: 1, generatedAt: new Date().toISOString(), assets: {} };
const scene = template.compose(parsed.config, manifest);

const artifact = await build(
  {
    target: parsed.config.build,          // e.g. { target: 'static', ssr: true, minify: true }
    outDir: 'dist/site',
    strictBudgets: process.env.CI === 'true',
    onReport: (text) => console.log(text),
  },
  (options) => generate(parsed.config, template, scene, options),
);
console.log('entry:', artifact.entry, 'budgets passed:', artifact.budgets.passed);
```

Then serve the output: `npx serve dist/site` (any static file server works).
A full walkthrough is in [docs/getting-started.md](docs/getting-started.md).

## Packages

| Package            | Path                  | Purpose                                                        |
| ------------------ | --------------------- | -------------------------------------------------------------- |
| `@lumen/contracts` | `contracts/`          | Frozen cross-module contract types ([README](contracts/README.md)) |
| `@lumen/kernel`    | `packages/kernel`     | Lifecycle, event bus, scheduler, capabilities, plugins ([README](packages/kernel/README.md)) |
| `@lumen/rendering` | `packages/rendering`  | IRenderer backends (DOM/Canvas2D/WebGL), adaptive quality ([README](packages/rendering/README.md)) |
| `@lumen/scene`     | `packages/scene`      | Scene graph, timeline evaluation, property binding ([README](packages/scene/README.md)) |
| `@lumen/assets`    | `packages/assets`     | Asset manifest, preloading, two-tier caching, loaders ([README](packages/assets/README.md)) |
| `@lumen/interaction` | `packages/interaction` | Input normalization, gestures, virtual scroll, bindings ([README](packages/interaction/README.md)) |
| `@lumen/templates` | `packages/templates`  | TemplateDescriptors for the 4 frontend types ([README](packages/templates/README.md)) |
| `@lumen/codegen`   | `packages/codegen`    | Config + scene → per-target code generation ([README](packages/codegen/README.md)) |
| `@lumen/config`    | `packages/config`     | EngineConfig schema, validation, migrations ([README](packages/config/README.md)) |
| `@lumen/build`     | `packages/build`      | Build/export pipeline, budgets, content hashing ([README](packages/build/README.md)) |
| `@lumen/runtime`   | `packages/runtime`    | Browser orchestration: boots generated SceneIR into a live engine ([README](packages/runtime/README.md)) |

Guides: [developer guide](docs/guide/README.md) ·
[architecture](docs/architecture.md) ·
[getting started](docs/getting-started.md) · [templates](docs/templates.md) ·
[extending](docs/extending.md) · [API index](docs/api-index.md) ·
[consolidated architecture](docs/consolidated-architecture.md) ·
[consolidated agents](docs/consolidated-agents.md)

## Development workflow

- **Branches**: one branch per module/agent, named `agent/<module>`
  (e.g. `agent/kernel`, `agent/docs`). Contracts are frozen by the
  orchestrator before module work begins (`agent/contracts`); module branches
  must not touch `contracts/`.
- **Ownership**: each change writes only inside its own directory
  (`packages/<name>/`, or `docs/` + root `README.md` for docs).
- **Monorepo**: npm workspaces; root scripts are `npm run build`
  (`scripts/build-all.sh`), `npm test` (e2e), `npm run typecheck`,
  `npm run example` (regenerate `examples/simple-site/dist/`). Per package:
  `npm run build` then `node --test test/`.
- **Build convention** (SPEC rule 3a): every package has a single
  `tsconfig.json` (`rootDir: "src"`, flat `dist/`, `@lumen/contracts`
  resolved against `contracts/dist`) and uniform `package.json` entries
  (`main`/`types`/`exports` → `./dist/index.*`). Build order lives solely in
  `scripts/build-all.sh`; `scripts/link-workspaces.mjs` shims each package as
  `<dir>/dist/index.js`. One sanctioned exception:
  `packages/build/tsconfig.test.json` for that package's TypeScript tests.
- **Definition of Done** (from [SPEC.md](SPEC.md)): `tsc` compiles against the
  frozen contracts, the public API is exported from `src/index.ts`, the module
  README documents responsibilities/API/usage, and nothing outside the module
  directory was modified.
- **Contract changes**: never edit `contracts/` directly. File a Contract
  Change Proposal; meanwhile implement a local adapter and document it in your
  module README. See [docs/extending.md](docs/extending.md#contract-changes-ccp).

## License

TBD — license file to be added before first public release.
