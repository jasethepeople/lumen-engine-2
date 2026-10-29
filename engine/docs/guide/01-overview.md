# 01 — Overview: What Lumen Is

Lumen is a **config-driven engine**: you write one declarative
`EngineConfig` (JSON or JSONC), and Lumen compiles it into a production web
frontend. You never write page code by hand — you describe scenes, assets,
interactions, and a theme, and the engine composes, generates, builds, and
boots the result.

One config targets one of **four frontend types** (the `TemplateKind` union
in `contracts/src/templates.ts`):

| Kind            | What you get                                                | Primary driver |
| --------------- | ----------------------------------------------------------- | -------------- |
| `scroll-video`  | Full-viewport video scrubbed by scrolling, caption overlays | scroll         |
| `cinematic-spa` | Sequenced, time-driven single-page experience               | time           |
| `viewer-3d`     | Orbital 3D product viewer with hotspots                     | pointer        |
| `storytelling`  | Long-form scrollytelling: blocks, media, sticky media       | scroll         |

## The pipeline mental model

Everything in Lumen is one pipeline. Learn these six stages and you know the
engine:

```
EngineConfig ─▶ parse/validate ─▶ compose ─▶ codegen ─▶ build ─▶ runtime boot
 (you write)    @lumen/config    @lumen/     @lumen/    @lumen/   @lumen/runtime
                migrate+defaults templates   codegen    build     bootEngine()
```

1. **Config** — you author an `EngineConfig` (see
   [03 — Writing configs](03-writing-configs.md)). `parseConfig()` runs
   **migrate → validate → defaults** and returns a fully typed config or a
   list of errors with precise JSON paths.
2. **Compose** — a `TemplateDescriptor` (looked up by `config.template` in a
   `TemplateRegistry`) maps your config plus an `AssetManifest` into a
   `ComposedScene`: a scene-node tree, timeline tracks, and interaction
   bindings. This is plain TypeScript — no string templating.
3. **Codegen** — `generate(config, descriptor, scene, options)` lowers the
   scene to a serializable **SceneIR** document and emits per-target entry
   modules (static site, Web Component, npm library, or runtime JSON loader).
4. **Build** — `build()` runs the phased pipeline
   (validate → generate → optimize → hash → emit → report), producing
   content-hashed files, a `manifest.json` deploy manifest, and a size-budget
   report in `dist/`.
5. **Runtime** — in the browser, the generated entry calls
   `bootEngine(rootEl, ir)`: it hydrates the SceneIR, starts the kernel
   (lifecycle, event bus, rAF scheduler), preloads `critical` assets, picks
   the best renderer backend, and runs the frame loop
   (interaction → timeline playheads → scene evaluation → render).

For the full architectural treatment, see
[../architecture.md](../architecture.md).

## Module map

| Package              | One-line role |
| -------------------- | ------------- |
| `@lumen/contracts`   | Frozen, dependency-free cross-module types (`EngineConfig`, `SceneIR`, `TemplateDescriptor`, …). The only home for shared types. |
| `@lumen/config`      | `parseConfig` / `validateConfig` / migrations / defaults for `EngineConfig`. |
| `@lumen/templates`   | The four `TemplateDescriptor`s, `TemplateRegistry`, theme token resolution + `--lumen-*` CSS variable emission. |
| `@lumen/codegen`     | `generate()`: config + composed scene → SceneIR + per-target entry modules. |
| `@lumen/build`       | `build()` / `buildAll()`: phased pipeline, content hashing, gzip budgets, build report. |
| `@lumen/kernel`      | Lifecycle state machine, typed event bus, rAF scheduler, capability detection, plugins. |
| `@lumen/scene`       | Scene graph, timeline evaluation, property bindings (pure, DOM-free). |
| `@lumen/rendering`   | Renderer backends (DOM, Canvas2D, WebGL2 via Three.js), adaptive quality. |
| `@lumen/assets`      | Asset manifest, priority preloading, two-tier caching, loaders. |
| `@lumen/interaction` | Input normalization, gestures, virtual scroller, interaction→timeline bindings. |
| `@lumen/runtime`     | Browser orchestration: `bootEngine()`, `hydrateIslands()`, SceneIR helpers. |

There is also a convenience entry point: `createEngine(configInput, options)`
from the root package runs parse → compose and returns a descriptor with
`boot(rootEl)` and `build(target)` methods — handy for scripts and tests.

## When to use Lumen

**Use it when:**

- Your site fits one of the four frontend types (scroll-scrubbed video,
  cinematic landing page, 3D product viewer, scrollytelling article).
- You want a declarative, reviewable, diffable config instead of bespoke page
  code — and performance budgets enforced by CI.
- You need multiple output flavors (static site *and* embeddable Web
  Component) from one source of truth.

**Don't use it when:**

- You need arbitrary app logic, forms, routing, or a CMS — Lumen renders
  composed scenes, not applications. Embed Lumen output (Web Component or npm
  target) inside a host app instead.
- Your design doesn't fit any template's slots and you can't express it by
  writing a custom `TemplateDescriptor`
  ([02 — Custom templates](02-custom-templates.md)).
- You need a backend; Lumen is frontend-only and its build pipeline is
  offline (Node ≥ 18).

## Where to go next

- [03 — Writing configs](03-writing-configs.md) — the `EngineConfig`, field by field.
- [04 — Building and exporting](04-building-and-export.md) — produce `dist/` artifacts.
- [05 — Worked example: scroll-video](05-example-scroll-video.md) — config to built site, end to end.
- [../templates.md](../templates.md) — slot catalogs and minimal configs per template.
