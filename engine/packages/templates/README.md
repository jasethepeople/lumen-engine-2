# @lumen/templates

Template descriptors for the four Lumen frontend types. Templates are plain
TypeScript modules — functions over config — not a string-templating language:
fully type-checked, unit-testable composition with no parser to maintain.

## Responsibilities

- Define one `TemplateDescriptor` per frontend type: `scroll-video`,
  `cinematic-spa`, `viewer-3d`, `storytelling`.
- Declare slots/regions (`SlotDefinition`) and the composition rules that map
  config scenes into scene-graph subtrees (`compose`).
- Own theme tokens (color, type scale, spacing, motion) with per-template
  defaults, merged with `EngineConfig.theme` overrides at compose time.
- Declare `ModuleRequirement` capabilities (renderers, asset features,
  interaction sources) that drive tree-shaking in codegen.
- Declare per-template performance budgets.

## Templates and slot conventions

| Template        | Slots                                   | Track drivers            |
| --------------- | --------------------------------------- | ------------------------ |
| `scroll-video`  | `stage` (1 video-plane), `caption`      | scroll (scrub)           |
| `cinematic-spa` | `hero`, `gallery`, `outro`              | time (sequenced clock)   |
| `viewer-3d`     | `model` (1 mesh), `hotspot`             | pointer (orbit)          |
| `storytelling`  | `block`, `media`, `sticky-media`        | scroll (enter/progress/exit per block) |

Scene ids from config map to `node-<sceneId>` groups and `track-<sceneId>`
timeline tracks; per-block storytelling tracks are suffixed
`-enter` / `-progress` / `-exit`. Template-specific metadata is namespaced on
nodes under `meta['<template-kind>']`, per the contract convention.

## Usage

```ts
import {
  createDefaultRegistry,
  scrollVideoTemplate,
  resolveThemeTokens,
  toCssVariablesString,
} from '@lumen/templates';

const registry = createDefaultRegistry();
const { warnings } = registry.validate(engineConfig); // warnings never block
const composed = registry.require(engineConfig.template).compose(engineConfig, assetManifest);
const css = toCssVariablesString(resolveThemeTokens(scrollVideoTemplate.themeTokens, engineConfig.theme));
```

`compose(cfg, manifest)` returns a structurally valid `ComposedScene` (unique
node/track ids, sorted keyframes, bindings referencing existing tracks);
`assembleScene` throws if any invariant is violated.

## Specialization descriptors

Beyond the four built-ins, this package ships two specialization templates
(TemplateKind is frozen, so they reuse an existing kind and are distinguished
by descriptor id, slot set, and node-meta namespacing). They are available via
`createExtendedRegistry()`, which keeps the built-ins but replaces the
`scroll-video` and `cinematic-spa` entries with the specializations;
`createDefaultRegistry()` is unchanged:

- **`scroll-cinema-landing`** (kind `scroll-video`) — premium scroll-scrubbed
  landing page: slots `stage`, `logo`, `hero-caption` (fades out over the first
  15% of scroll), `chapters` (0–6 fade-in/hold/fade-out overlays, optional
  `meta.scrollRange`), `outro` (fades in over the last 12%), plus a 1.0→1.08
  parallax scale track on the video plane.
- **`cinematic-story`** (kind `cinematic-spa`) — time-driven storytelling:
  slots `title-card` (3s), `acts` (2–8, 1.2s crossfade overlap, per-act
  `meta.durationHint`), `score` (audio carrier), `credits`; keyboard
  interactions resolve onto act tracks (`scene:next` / `scene:prev` contract);
  reduced-motion cuts via linear easings + a `reducedMotion` meta flag.

See `docs/guide/07-template-designs.md` for schemas, mappings, and runnable
examples (`examples/scroll-cinema-landing/`, `examples/cinematic-story/`).

## Collaboration

- **Codegen** consumes descriptors + `compose()` output (`ComposedScene`) and
  the `requiredCapabilities` set (via `registry.capabilities()`) for
  tree-shaking and chunk planning.
- **Config agent** supplies the validated `EngineConfig`; this package only
  reads it and never mutates it.
- **Assets** supplies the `AssetManifest`; templates resolve asset ids against
  it and flag missing assets in node `meta` (non-fatal).

Zero runtime dependencies. Contracts are consumed via `@lumen/contracts` and
are never modified here.

## Tests

```
npm run test   # tsc + node --test test/
```

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
