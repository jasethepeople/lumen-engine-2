# @lumen/rendering

Rendering layer for the Lumen engine. Implements the frozen `IRenderer`
contract (`@lumen/contracts`) across multiple backends, picks the right
backend for the device, and adapts quality to hold the frame budget.

## Responsibilities

- **Backend implementations** behind one `IRenderer` interface:
  - `DomRenderer` — maps `dom`/`video` draw calls onto absolutely-positioned,
    CSS-transformed elements with element pooling and viewport culling.
    **Browser-only** (importing in Node is safe; `init()` throws a typed
    `RenderingError` without a document).
  - `Canvas2DRenderer` — draws image/sprite primitives and text nodes into a
    2D canvas; `createTarget()` allocates offscreen 2D targets
    (`OffscreenCanvas` when available). Dependency-free.
  - `WebGLRenderer` — Three.js (r160+) backend for `mesh` / `video-plane` /
    `sprite` payloads, with a pluggable `MeshFactory` and `CameraState`
    mapping. Three is an **optional peer dependency**, loaded lazily via
    dynamic import; when absent, `WebGLRenderer.create()` throws
    `RenderingError { code: 'RENDERER_UNAVAILABLE' }` which the selector
    catches to fall back.
  - **WebGPU — stub path.** `selectRenderer()` already prefers `webgpu` when
    `CapabilityProfile.webgpu` is true, but `createRenderer('webgpu')` throws
    a recoverable typed error and falls back to `webgl2`. A future
    `WebGPURenderer` (three.js `WebGPURenderer` + TSL node materials) plugs
    into `select.ts` without touching callers.
- **Backend selection** — `selectRenderer(profile, preference?)` implements
  the fallback chain `webgpu → webgl2 → canvas2d → dom`; `createRenderer()`
  constructs the chosen backend and auto-falls-back on recoverable failures.
- **Adaptive quality** — `AdaptiveQualityController` consumes `FrameStats`,
  tracks a frame-time EMA, and steps a discrete quality ladder (DPR scale
  0.5–2.0, MSAA, post passes, shadow map size) with separate up/down
  thresholds (hysteresis) and a 500 ms cooldown to avoid oscillation.

## Collaboration

- **Kernel** feeds scheduler frames: it supplies the `CapabilityProfile` for
  selection and receives `FrameStats` (written in-place by `renderFrame`)
  plus budget overruns. The kernel (or host loop) owns calling
  `AdaptiveQualityController.update(stats)` and pushing the result through
  `IRenderer.setQuality()`.
- **Scene agent** provides world state as resolved `RenderFrame` draw lists.
  `DrawCall.payload` is opaque in the contracts; the per-backend payload
  conventions are documented in each renderer's module docblock. If the scene
  package emits different payload shapes, add a local adapter here — contracts
  are frozen.
- **Assets** hands decoded `TextureAsset`s (ideally `ImageBitmap`) to
  `uploadTexture`; raw byte buffers are stored but only decoded images draw.

## Usage

```ts
import { createRenderer, selectRenderer, AdaptiveQualityController } from '@lumen/rendering';

const backend = selectRenderer(kernel.capabilities);           // 'webgpu' | 'webgl2' | ...
const renderer = await createRenderer(backend, { surface: canvas });

const quality = new AdaptiveQualityController(
  { budgetMs: 16.7, maxDpr: kernel.capabilities.dpr.max },
  ['bloom', 'grain'],
);

function onFrame(frame: RenderFrame, stats: FrameStats) {
  renderer.renderFrame(frame, stats);                          // stats filled in-place
  if (quality.update(stats)) renderer.setQuality(quality.getLevel());
}

renderer.resize(cssWidth, cssHeight, devicePixelRatio);
```

Inject a pre-loaded three module (tests, custom bundles):

```ts
import { WebGLRenderer } from '@lumen/rendering';
const renderer = await WebGLRenderer.create({ three: await import('three'), meshFactory: myFactory });
```

## Development

```sh
tsc -p tsconfig.json        # typecheck + emit dist/
node --test test/           # unit tests (DOM-free logic only)
```

DOM-dependent render paths are exercised in `tests/e2e` (browser); unit tests
here cover selection logic, quality hysteresis, and pooling math.

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
