# @lumen/interaction

Input normalization, gesture recognition, virtual scrolling, and interaction→timeline bindings for the Lumen engine.

## Responsibilities

- **Normalize** raw DOM input (wheel, pointer/touch, keyboard, deviceorientation) into `NormalizedInputEvent`s with unified viewport-normalized coordinates (0–1), DOMHighResTimeStamp timestamps, and smoothed velocity estimates.
- **Recognize gestures** — tap, double-tap, pan, pinch (scale + rotation), swipe, long-press — as pure, composable state machines with priority-based conflict resolution (pinch > pan > swipe > tap/long-press).
- **Virtualize scroll** into a frame-deterministic smoothed playhead (`VirtualScroller` contract): raw deltas are consumed, smoothing (lerp) is applied exactly once per frame, progress is clamped 0–1, with optional section snapping and a reduced-motion instant mode.
- **Bind interactions to the scene timeline** via `InteractionBinding` runtimes: input domains map to timeline seconds with linear curves, optional lerp/spring smoothing and snap points, plus accessibility fallbacks.
- **Accessibility**: `steps` fallback quantizes output to discrete, keyboard-navigable steps (Arrow/Page/Home/End keys); `static` and `native-video` deactivate the binding; `prefers-reduced-motion` is auto-detected and tracked live.

## API

| Export | Purpose |
| --- | --- |
| `InteractionManager` | Top-level facade: `attach(rootEl)`, `registerBinding(s)`, `update(dt) → DriverMap`, `detach()`. |
| `InputNormalizer` | DOM listener wiring → normalized events (`onEvent`, `onPointer`). Guarded no-op without a DOM. |
| `GestureRecognizer` | Pure state machine; `feed(PointerSample)`, emits via `onGesture`. |
| `LumenVirtualScroller` | `VirtualScroller` impl: `feedDelta`, `update(dt)`, `seek`, `setEnabled`, snapping. |
| `BindingRuntime` | Per-binding mapping + smoothing + snapping + keyboard steps. |
| `createDoubleTapDetector` | Stateless double-tap helper over a tap event stream. |

## Usage

```ts
import { InteractionManager } from '@lumen/interaction';

const manager = new InteractionManager({
  bindings: [
    {
      id: 'scroll-hero',
      source: 'scroll',
      targetNodeId: 'hero',
      targetTrackId: 'hero.scrub',
      mapping: {
        inputRange: [0, 1],
        outputRange: [0, 12],           // timeline seconds
        smoothing: { type: 'lerp', factor: 0.12 },
        snap: [0, 4, 8, 12],
      },
      a11yFallback: 'steps',
    },
  ],
  onNavigate: (dir) => bus.emit(dir === 'next' ? 'scene:next' : 'scene:prev'),
});

manager.attach(document.getElementById('root'));

// Each frame, from the Kernel scheduler:
const drivers = manager.update(dtSeconds);
scene.evaluate(time, { drivers });     // ← handshake with @lumen/scene

// Teardown:
manager.detach();
```

### Driver-map handshake with @lumen/scene

`update(dt)` returns `{ [targetTrackId: string]: number }` — TimelineTrack.id →
scalar timeline seconds. The Scene package's `evaluate()` consumes this via its
`drivers` parameter. The Kernel scheduler owns calling `update()` exactly once
per frame (frame determinism: all smoothing advances are dt-compensated against
a 60 fps baseline).

### Collaboration

- **Scene agent** consumes the driver map (above). `onNavigate` emits raw
  step-navigation *intent* (`'next'` / `'prev'`) only — this package does not
  know navigation event names. The mapping of intent to `scene:next` /
  `scene:prev` bus events lives solely in `@lumen/runtime` (`engine.ts`).
- **Kernel** calls `update(dt)` from its scheduler and `attach`/`detach` with
  lifecycle.

## Testing & DOM boundaries

Core logic is DOM-free: gesture recognizers, scroller, and binding runtimes are
pure state machines driven by synthetic events (see `test/`, run with
`npm test` → `node --test`). Only `InputNormalizer.attach`,
`LumenVirtualScroller.attach(el)`, and the manager's keyboard/matchMedia wiring
touch the DOM; all are guarded no-ops outside a browser and use passive
listeners. Run `npm run typecheck` for a clean `tsc` pass against the frozen
contract sources.

## Contract gaps (local adapters)

- `NormalizedInputEvent` has no pointer lifecycle phase/pointerId; gestures are
  fed `PointerSample` (extends the contract type with `phase` + `pointerId`),
  defined locally in `src/normalize.ts`.
- `GestureType` lacks `doubletap`; the recognizer emits two consecutive `tap`
  events and ships `createDoubleTapDetector` for consumers.

## Build

```
npm run build   # builds contracts declarations, then tsc → dist/
npm test        # build + node --test test/
```

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
