# @lumen/runtime

Browser runtime for the Lumen engine — the package generated code imports.
Thin orchestration glue over the module packages; it owns no rendering,
scene, or asset logic itself.

## API

```ts
import { bootEngine, hydrateIslands } from '@lumen/runtime';

const engine = await bootEngine(document.getElementById('lumen-root'), sceneIR);
await hydrateIslands(engine, sceneIR.hydration.islands);

engine.on('render:quality-change', ({ dprScale }) => console.log('quality', dprScale));
engine.pause(); engine.resume(); await engine.dispose();
```

### `bootEngine(rootElement, ir, options?) → Promise<LumenEngine>`

Boot sequence, mapped onto the kernel lifecycle:

1. **Parse/accept SceneIR** — the versioned JSON document emitted by
   `@lumen/codegen`. Declared *structurally* in `src/ir.ts` (no codegen
   import); `parseSceneIR()` accepts an object or JSON string and validates
   the shape.
2. **`createKernel()`** — lifecycle, event bus, scheduler, capabilities.
3. **Asset preload** — an `AssetManager` is initialized with a manifest
   synthesized from `ir.assets` (`manifestFromAssetRefs`); preloading runs as
   a kernel plugin during the `loading` phase, progress flows onto the bus as
   `asset:progress`, and per-asset failures surface as recoverable
   `engine:error` events (they never abort boot).
4. **Scene construction** — `composedSceneFromIR()` raises the IR into a
   contract `ComposedScene` (nodes/tracks/bindings) and `createSceneRuntime()`
   keeps a live graph. No `TemplateDescriptor` is needed at runtime.
5. **Renderer** — `selectRenderer(capabilities, preference?)` +
   `createRenderer()` against a canvas appended to the root element;
   `AdaptiveQualityController` steps the quality ladder from per-frame
   `FrameStats` and publishes `render:quality-change`.
6. **Frame loop** (kernel scheduler, priority 30 / phase `'render'`):
   `interaction.update(dt)` → driver map → per-track playhead merge →
   `applyBindings` + world-transform update → world-state → `RenderFrame`
   draw-list adapter → `renderer.renderFrame()`.

**Reduced motion**: when the capability profile (or `options.reducedMotion`)
says so, time-driven tracks hold at their first frame (only user-driven
scroll/pointer tracks advance) and the interaction layer switches to instant,
step-quantized output.

**DOM guards**: importing this module under Node is safe. `bootEngine()`
throws a plain `Error` without a DOM; `hydrateIslands()` no-ops.

### `hydrateIslands(engine, islands) → Promise<void>`

Locates each SSR island anchor (`ir.hydration.islands` DOM ids), marks it
`data-lumen-hydrated`, and dispatches a `lumen:hydrate` CustomEvent. Missing
anchors are skipped.

## Adapters owned here (contracts untouched)

- **Driver-map merge**: `@lumen/interaction` emits per-track seconds
  (`trackId → scalar`); `@lumen/scene`'s `resolvePlayheads` keys by driver
  *kind*. The frame loop resolves default playheads, then overrides
  individual tracks from the driver map before `applyBindings`.
- **World state → RenderFrame**: draw-call payloads follow the DomRenderer
  decoding documented in `@lumen/rendering` (`{kind, html?, assetId?, rect,
  opacity?, transform?, visible?}`); mesh/sprite calls carry the raw world
  transform for the WebGL backend.
- **Manifest synthesis**: `manifestFromAssetRefs()` builds a minimal
  `AssetManifest` from `IRAssetRef`s (also used by the root `createEngine`).

## Build

```sh
bash scripts/build-all.sh   # contracts + all packages + runtime, in order
```

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
