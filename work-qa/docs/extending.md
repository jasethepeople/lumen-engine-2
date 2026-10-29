# Extending Lumen

Four supported extension points: plugins, custom templates, custom renderers,
and (with care) the contracts themselves.

## Plugins (`LumenPlugin`)

Plugins hook the kernel lifecycle. Declare a name/version, optional
capability tokens (`provides` / `consumes` — resolved as a DAG, initialized in
topological order, disposed in reverse), and `init`/`dispose` hooks. `init`
receives a narrowed `KernelContext`: immutable `capabilities`, typed event
subscription via `events`, and `reportError`.

```ts
import { createKernel } from '@lumen/kernel';
import type { LumenPlugin } from '@lumen/contracts';

const analytics: LumenPlugin = {
  name: 'analytics',
  version: '1.0.0',
  consumes: [],
  init(ctx) {
    // ctx: { capabilities, events, reportError }
    if (!ctx.capabilities.reducedMotion) {
      ctx.events('timeline:seek', ({ time }) => track(time));
    }
  },
  dispose() { /* unsubscribe / flush */ },
};

const kernel = createKernel();
kernel.registerPlugin(analytics);
```

Rules: cycles, missing providers, and duplicate names raise structured
errors; a throwing plugin is contained by the kernel error boundary and
reported on `engine:error`.

## Custom templates (`TemplateDescriptor`)

A template is a plain TypeScript module implementing the contract:

```ts
import type { TemplateDescriptor, ComposedScene } from '@lumen/contracts';

export const myTemplate: TemplateDescriptor = {
  kind: 'scroll-video',          // reuse a kind, or see CCP below for new ones
  version: '1.0.0',
  slots: [
    { id: 'stage', accepts: ['video-plane'], min: 1, max: 1, region: 'spatial' },
  ],
  themeTokens: { /* colors, typeScale, spacing, motion defaults */ } as never,
  requiredCapabilities: {
    renderers: ['webgl2', 'canvas2d'],
    assetFeatures: ['hls'],
    interactions: ['scroll'],
  },
  budgets: { jsGzBytes: 170_000, criticalAssetBytes: 1_200_000, firstFrameMs: 1500 },
  compose(cfg, manifest): ComposedScene {
    // Map cfg.scenes (validated, defaulted) into a scene-node forest +
    // timeline tracks. Use @lumen/scene helpers; merge theme overrides via
    // resolveThemeTokens from @lumen/templates.
    /* ... */
  },
};
```

Register it alongside (or instead of) the defaults:

```ts
import { TemplateRegistry } from '@lumen/templates';

const registry = new TemplateRegistry([myTemplate]);
const descriptor = registry.get(cfg.template);
const scene = descriptor.compose(cfg, manifest);
```

`@lumen/templates` helpers worth reusing: `resolveThemeTokens`,
`toCssVariablesString`, `defaultTypeScale`, `defaultSpacing`, `defaultMotion`
(this package is the single home of theme merging and `--lumen-*`
CSS-variable emission — codegen delegates to it, so do not re-implement
these). Follow the naming conventions: `node-<sceneId>` groups,
`track-<sceneId>` tracks, template metadata under
`meta['<template-kind>']`.

If your template (or a custom codegen consumer) needs the serialized
scene representation, the `SceneIR` contract (`SceneIR`, `IRNode`,
`IRTrack`, `IRBinding`, `IRAssetRef`, `SCENE_IR_VERSION`) lives in
`@lumen/contracts` (`contracts/src/ir.ts`) and is re-exported by both
`@lumen/codegen` and `@lumen/runtime`. Import it from contracts; never
re-declare it locally — the wire format (`version: 1` JSON shape) is
frozen and byte-compatible across producer and consumer.

> `TemplateKind` is a frozen contract union. Reusing an existing kind for a
> custom descriptor works today; adding a *new* kind string requires a
> contract change (see CCP below).

## Custom renderers (`IRenderer`)

Implement the frozen `IRenderer` interface to add a backend (e.g. WebGPU, an
offscreen-canvas worker renderer, a test double):

```ts
import type { IRenderer, RenderFrame, FrameStats, QualityLevel } from '@lumen/contracts';

class MyRenderer implements IRenderer {
  readonly backend = 'webgl2'; // existing RendererBackend union member
  async init(surface: HTMLCanvasElement | OffscreenCanvas) { /* GL setup */ }
  createTarget(desc) { /* offscreen target; return a handle */ }
  uploadTexture(asset) { /* decoded TextureAsset -> GPU handle */ }
  renderFrame(frame: RenderFrame, stats: FrameStats) {
    // draw frame draw-calls; fill stats in-place (frame time, draw calls, …)
  }
  setQuality(q: QualityLevel) { /* apply dprScale, msaa, post passes */ }
  resize(width: number, height: number, dpr: number) { /* physical = css * dpr */ }
  dispose() { /* release GPU/host resources */ }
}
```

Integration notes:

- `DrawCall.payload` is opaque in the contracts — document your payload
  conventions in the renderer's docblock and add a local adapter if the scene
  package emits different shapes (contracts are frozen).
- Textures arrive via `uploadTexture` as decoded `TextureAsset`s (ideally
  `ImageBitmap`) from `@lumen/assets`.
- Backends that can be unavailable should fail with a typed error at
  construction (the pattern used by `WebGLRenderer.create()` /
  `RENDERER_UNAVAILABLE`) so `selectRenderer` can fall back along
  `webgpu → webgl2 → canvas2d → dom`.
- Pair with the existing `AdaptiveQualityController` from `@lumen/rendering`
  rather than writing your own quality loop.

## Adding a new package

New packages must follow the unified build convention (SPEC rule 3a), same
as the existing eleven:

- One `tsconfig.json` (extends `../../tsconfig.base.json`,
  `rootDir: "src"`, `outDir: "dist"`, `composite: false`,
  `include: ["src"]`, `paths` mapping `@lumen/contracts` — and any sibling
  packages — to their `dist/index.d.ts`). No extra `tsconfig.build.json`.
- Uniform `package.json`: `"main": "./dist/index.js"`,
  `"types": "./dist/index.d.ts"`,
  `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`,
  `"files": ["dist", "README.md"]`, scripts `build` / `typecheck` / `test`
  (`"build": "tsc -p tsconfig.json"`, `"test": "npm run build && node --test test/"`),
  `"license": "UNLICENSED"`.
- Register the package in `scripts/build-all.sh` (build order is owned
  there — never shell out to build another package from your own build
  script) and add its directory to `PACKAGE_DIRS` in
  `scripts/link-workspaces.mjs` (every package shims as
  `<dir>/dist/index.js`).

## Contract changes (CCP)

Contracts are **sacred and orchestrator-owned** (SPEC sacred rule #1). You may
never edit `contracts/` from a module branch.

When you hit a contract gap:

1. **Implement a local adapter** in your module and keep shipping.
2. **Document the gap in your module README** under a "contract gaps" heading
   (precedent: `@lumen/interaction` documents `PointerSample` extending
   `NormalizedInputEvent` with `phase`/`pointerId`; `@lumen/scene` documents
   the `material.*` → `payload.material.*` path alias).
3. **File a Contract Change Proposal** with the orchestrator: the type to
   add/change, the consumer(s), why a local adapter is insufficient, and
   migration impact. Contract changes are batched and frozen by the
   orchestrator between rounds — never ad-hoc.
