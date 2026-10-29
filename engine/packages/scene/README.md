# @lumen/scene

Scene graph, timeline evaluation, and property binding for the Lumen engine.
Pure math + data structures — **zero runtime dependencies, DOM-free**, runs in
Node, browsers, and workers (safe for OffscreenCanvas rendering threads).

## Responsibilities

- Maintain the `SceneNode` hierarchy (`SceneGraph`): parent/child links,
  world-transform computation with **dirty-flag propagation** (unchanged
  subtrees are skipped each frame), structural edits (add / remove / reparent),
  find/traverse, and JSON-safe serialize/deserialize for the build pipeline.
- Evaluate `TimelineTrack`s at any playhead position: full `EasingName` set,
  CSS-style `CubicBezier` easing, number/vector/string keyframe interpolation,
  loop modes (`none` | `loop` | `pingpong`), clamping, and progress scrubbing.
- Apply `PropertyBinding`s to node properties via dotted paths
  (`transform.position.y`, `material.opacity`, `payload.*`), driver-agnostic:
  tracks declare a `driver` (`time` / `scroll` / `pointer` / `playback`), the
  caller supplies the scalar.
- Wire a `ComposedScene` (from the Templates module) into a runtime and produce
  per-frame **world state** consumed by the Rendering layer.

## Neighbors

- **Templates** produces `ComposedScene` (graph + tracks + hydration hints).
- **Rendering** consumes the `WorldState` entries (world transform, effective
  visibility, layer) to build its draw list.
- **Interaction** drives bindings by passing external driver scalars (scroll
  progress, pointer position) into `evaluate` / `SceneRuntime.evaluateAt`.

## API

### Math (`math.ts`)
`vec2/vec3`, `add3/mul3/scale3`, `lerp/lerpArray/lerpVec3`,
`quatIdentity/quatMul/quatNormalize/quatRotateVec3/quatNlerp`,
`identityTransform/cloneTransform/composeTransform/lerpTransform/transformsEqual`.
Transforms compose as TRS without shear (scales multiply component-wise).

### SceneGraph (`graph.ts`)
```ts
const graph = new SceneGraph(roots);          // or SceneGraph.deserialize(json)
graph.find(id); graph.traverse((node, depth) => {});
graph.addNode(parentId | null, node);
graph.removeNode(id);
graph.reparent(id, newParentId | null);       // cycle-checked
graph.setLocalTransform(id, t);               // marks dirty
graph.updateWorldTransforms();                // recomputes dirty subtrees only
graph.getWorldTransform(id);
graph.serialize();                            // JSON-safe SceneNode[]
```

### Timeline (`timeline.ts`)
```ts
evaluateTrack(track, t, { loop: 'pingpong', easing: [0.42, 0, 0.58, 1] });
evaluateTrackAtProgress(track, 0.5);          // normalized scrub
applyEasing('ease-in-out', t); cubicBezierEase(bezier, t);
```

### Bindings (`binding.ts`)
```ts
const playheads = resolvePlayheads(tracks, time, { scroll: scrollY });
applyBindings(graph, tracks, playheads);      // writes values, marks transforms dirty
```

### Scene runtime (`runtime.ts`)
```ts
import { evaluate, createSceneRuntime } from '@lumen/scene';

// Pure snapshot (codegen / SSR / tests) — never mutates the ComposedScene:
const world = evaluate(composedScene, timeSeconds, { scroll: 0.4 });
for (const e of world.entries) { /* e.worldTransform, e.visible, e.layer */ }

// Stateful render-loop runtime — only dirty subtrees recompute per frame:
const runtime = createSceneRuntime(composedScene);
const frame = runtime.evaluateAt(t, { scroll: scrollY });
```

## Notes / contract adapters

- Contract `PropertyBinding.property` mentions `material.opacity`; nodes store
  materials under `payload.material`, so `material.*` is aliased to
  `payload.material.*` in `resolvePath` (local adapter, contracts untouched).
- Loop modes are an evaluation-time option (`EvaluateOptions.loop`), since the
  frozen `TimelineTrack` contract has no loop field.
- Quaternion keyframes should be keyframed as 4-component arrays; transform
  lerp uses shortest-path nlerp (`quatNlerp`).

## Tests

```sh
npm run build        # tsc -p tsconfig.json
npm test             # build + node --test test/
```

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
