# Lumen Engine — Phase 3 Implementation Plans

*One implementation plan per P1–P17 from `docs/analysis/phase2-proposed-improvements.md`.
Plans marked `approved-for-patch` are specified to the level where a coder can
produce a unified diff directly: exact files, insertion seams (fresh `file:line`
anchors re-verified against the working tree), type fragments, behavior
before→after, test cases, and migration notes. Plans marked `plan-only` are
architecture-level and **must not be patched in phase 4**.*

**Hard constraints (all plans):** additive optional fields only; no renames of
frozen contract names (`SCENE_IR_VERSION`, `SceneIR`/`IRNode`/`IRTrack`/
`IRAssetRef` field names, `RenderFrame`, `QualityLevel`, `EngineEventMap` keys,
`IRenderer` methods, `DriverMap`); no new runtime dependencies; plans attach to
the existing seams: `DriverMap` (`packages/interaction/src/manager.ts:46`),
frame-adapter (`packages/rendering/src/frame-adapter.ts:39-92`), scheduler
hooks (`packages/kernel/src/scheduler.ts:34-44`), capability profile
(`contracts/src/kernel.ts:28-45`), template compose helpers
(`packages/templates/src/internal.ts`).

Note on anchors: Phase 1/2 cited a few stale line numbers (e.g.
`scene.ts:214-228`); every anchor below was re-read against the current tree.

---

## (a) SceneIR v1 → v1.1 delta summary

All changes are **additive optional fields**; `SCENE_IR_VERSION` stays `1`
(`contracts/src/ir.ts:18`). Old v1 documents parse unchanged; new fields are
ignored by old runtimes (validation at `packages/runtime/src/ir.ts:31-90`
checks only structural invariants and tolerates unknown keys).

| Field | Type (optional) | Owner plan | File |
|---|---|---|---|
| `IRTrack.motion` | `'continuous' \| 'reveal' \| 'static'` | P1 | `contracts/src/ir.ts:41-47` |
| `SceneIR.a11y[sceneId].motion` | same enum (scene default) | P1 | `contracts/src/ir.ts:91` |
| `IRAssetRef.variants` | `IRAssetVariant[]` (see P2) | P2 | `contracts/src/ir.ts:53-60` |
| `IRNode.anchor` | `Vec3` (DomPayload 3D anchor passthrough) | P11 | `contracts/src/ir.ts:21-38` |
| `IRNode.layerGroup` | `string` (DOM stacking-context group) | P11 | `contracts/src/ir.ts:21-38` |
| `IRNode.rect` | `{x,y,width,height}` (explicit DOM rect) | P11 | `contracts/src/ir.ts:21-38` |
| `IRTrack.smoothing` | `{mode:'lerp'\|'spring'\|'none', stiffness?, damping?}` | P15 | `contracts/src/ir.ts:41-47` |
| `IRTrack.segments` | `Array<{id, from, to, keys}>` | P15 | `contracts/src/ir.ts:41-47` |
| `Keyframe.easingBezier` | `CubicBezier` (alongside named `easing`) | P15 | `contracts/src/scene.ts:95-102` |
| `SceneIR.minRuntime` | `string` (advisory, P8 error payload only) | P8 | `contracts/src/ir.ts:66-92` |

Non-IR additive contract changes: `LumenPlugin.optional?: boolean`
(`contracts/src/kernel.ts:101-114`, P14); `EngineEventMap['engine:visibility']`
(`contracts/src/kernel.ts:73-98`, P4).

## (b) Cross-plan ordering & dependencies

1. **P2 before P7 and P16.** `pickVariant` (P7) consumes
   `IRAssetRef.variants`; P16's bandwidth class is a later input to the same
   pure function. P2 alone is behavior-preserving.
2. **P1 before P5's snap behavior and P15's `smoothing` consumption.** P5's
   camera snap-under-`reveal` and P15's "policy forces `mode:'none'`" both read
   the `MotionPolicy` object P1 introduces. Land P1's policy first; P5/P15
   degrade to current behavior if the policy is absent.
3. **P15 (smoothing) before P1's scroller rewiring is *not* required**, but
   P1 must not regress P15: the scroller clamp sites become
   `policy.interpolate()` which internally honors `track.smoothing`.
4. **P11 (rect/layerGroup) is independent but touches the same two files as
   P5** (`frame-adapter.ts`, `renderer-dom.ts`); sequence P5 → P11 to avoid
   diff conflicts.
5. **P13 before P6** gives the longer ladder immediate effect via inert
   post-pass names; P6 (plan-only) later makes per-pass shedding visible.
6. **P8 + P17 jointly** close the white-screen/crawlability hole; P17's
   `data-lumen-skeleton` marker is what P8 detects — land P17's codegen marker
   in the same patch as P8's runtime check.
7. **P10 (compose context)** is fully isolated; do it early so template tests
   for P1/P15 emit new fields through the threaded context.
8. **P4, P9, P12, P14** are mutually independent; any order.

Suggested phase-4 landing order: P10 → P2 → P7 → P1 → P15 → P5 → P11 → P13 →
P9 → P4 → P14 → P12 → P17+P8.

## (c) Validation strategy

**Must stay green (existing suites):** `node --test tests/e2e/`
(`smoke.test.mjs`, `qa-scrub-vendor.test.mjs`) plus every package suite:
`packages/runtime/test/{ir,scrub}.test.mjs`,
`packages/scene/test/{binding,graph,timeline}.test.mjs`,
`packages/interaction/test/{scroll,manager,bindings,gestures,normalize}.test.mjs`,
`packages/kernel/test/{kernel,lifecycle,event-bus}.test.mjs`,
`packages/rendering/test/{dom-transform,pooling,quality,select}.test.mjs`,
`packages/assets/test/*`, `packages/codegen/test/*`,
`packages/templates/test/*`, and `npm run typecheck`
(`tsc -p tsconfig.build.json --noEmit`).

**Backward-compat gate:** for every IR-touching plan (P1, P2, P8, P11, P15) add
a "v1 fixture parses and behaves byte-identically" case reusing the existing
fixtures in `packages/runtime/test/ir.test.mjs` and
`packages/templates/test/fixtures.mjs`; absence of every new field must
reproduce today's behavior exactly (defaults enumerated per plan).

**New test estimate:** ~95–115 new cases across ~14 new or extended test files
(per-plan case lists below; roughly P1:14, P2:8, P4:8, P5:8, P7:8, P8:5,
P9:8, P10:5, P11:10, P12:6, P13:8, P14:6, P15:12, P17:6).

## (d) Risk register

| # | Risk | Plans | Likelihood | Mitigation |
|---|------|-------|-----------|------------|
| R1 | New IR fields silently dropped by `lowerToIR` passthrough (`codegen/src/ir.ts:83-96` rebuilds tracks/assets field-by-field) | P1,P2,P15 | **High** | Explicitly extend the lowering maps; add round-trip test compose→lower→raise |
| R2 | MotionPolicy drifts from the three legacy clamp sites it replaces | P1 | Med | Single owner in engine; legacy boolean path kept only as derived default; cross-site integration test |
| R3 | Camera resolution runs per frame even with no camera node | P5 | Low | Cache "first camera node id" at scene build; skip DFS when absent |
| R4 | `matrix3d()` transform strings break DomRenderer css-diff cache keys | P11 | Med | Include full transform string in `lastCss` key (already covered by `renderer-dom.ts:244-245`) |
| R5 | Longtask observer double-counts scheduler-measured overruns | P4 | Med | Attribute longtasks as *external pressure* flag on FrameStats-adjacent bus event, not as synthetic overruns |
| R6 | Quality ladder re-index changes perceived default quality | P13 | Med | Expanded table is generated so rung 0..5 match the old LADDER exactly; preset test |
| R7 | Optional-plugin degradation masks real boot failures | P14 | Low | Fail fast when another plugin `consumes` a failed provider's token; mandatory default unchanged |
| R8 | Scroll restoration writes `history.state` too often | P9 | Med | Persist only on snap-settle / section boundary; throttle ≥500 ms |
| R9 | Old runtime + new IR (forward compat) | P1,P2,P11,P15 | Low | Validation tolerance verified by test: v1 runtime parses v1.1 doc and ignores unknown fields |
| R10 | SSR skeleton detection misfires on non-Lumen markup | P8 | Low | Require `data-lumen-skeleton` marker emitted by codegen (P17), never class-name sniffing |

---

## P1 — First-class reduced-motion semantics on the wire

`STATUS: approved-for-patch`

**Files to modify**

1. `contracts/src/ir.ts` — extend `IRTrack` (anchor `ir.ts:41-47`) and the
   `a11y` record value type (anchor `ir.ts:91`):

```ts
// contracts/src/ir.ts (new, exported)
export type MotionMode = 'continuous' | 'reveal' | 'static';

export interface IRTrack {
  id: string; target: string; driver: TimelineTrack['driver'];
  range: [number, number]; keyframes: TimelineTrack['keyframes'];
  /** Per-track reduced-motion override; absent = inherit scene/default. */
  motion?: MotionMode;
}
// SceneIR:
a11y: Record<string, { label: string; summary?: string; motion?: MotionMode }>;
```

2. `packages/codegen/src/ir.ts` — the track lowering map at `ir.ts:83-89`
   rebuilds tracks field-by-field (risk R1); add
   `...(t.motion !== undefined ? { motion: t.motion } : {})`. The scene-level
   `a11y` build at `ir.ts:67-71` gains
   `...(sc.a11y.motion !== undefined ? { motion: sc.a11y.motion } : {})`
   (requires matching optional `motion` on `SceneConfig['a11y']` in
   `contracts/src/config.ts` — additive).
3. `packages/runtime/src/motion.ts` — **new file**, the single policy owner:

```ts
export interface MotionPolicy {
  readonly mode: MotionMode;            // resolved per engine
  advanceTime(elapsed: number, dt: number): number; // 'static'|'reveal' → elapsed unchanged? no:
  // 'continuous': elapsed+dt · 'reveal': elapsed+dt (time passes, interpolation changes)
  // 'static': 0 held
  interpolate(current: number, target: number, alpha: number): number; // reveal/static → target
  quantizeScrub(seconds: number, boundaries: readonly number[]): number;
  trackMode(track: IRTrack): MotionMode; // track.motion ?? sceneDefault ?? 'continuous'
}
export function createMotionPolicy(opts: {
  reducedMotion: boolean; sceneDefault?: MotionMode;
  boundaries?: readonly number[];        // scene section boundaries (scroll snap points)
}): MotionPolicy;
```

Semantics (locking Phase 2): `continuous` = today; `reveal` = state changes
only — crossfades become cuts, scroll tracks step to snap boundaries, no
smoothing; `static` = time tracks hold at t=0, poster (P17) shown.
**Driver kind never changes; only interpolation policy does.**

4. `packages/runtime/src/engine.ts` —
   - Insertion seam 1: after `reducedMotion` resolution (`engine.ts:174`),
     construct `const policy = createMotionPolicy({ reducedMotion,
     sceneDefault: sceneMotionFromA11y(ir), boundaries: snapPoints })`.
   - Insertion seam 2: replace the clamp `if (!reducedMotion) elapsed += dt;`
     (`engine.ts:230`) with `elapsed = policy.advanceTime(elapsed, dt);`.
   - Insertion seam 3: pass `policy` into `InteractionManager` options
     (`engine.ts:210-214`) as new optional field `motion?: MotionPolicy`.
   - Insertion seam 4: scrub loop (`engine.ts:238`) — wrap the scrubber with
     `policy.quantizeScrub` for tracks whose resolved mode is `reveal`
     (boundaries = track keyframe `t` values), closing the Phase 1 §4 drift
     where a scroll-scrubbed `video-plane` still seeks frame-accurately.
5. `packages/interaction/src/scroll.ts` — keep the class, but when
   `policy` is supplied (new optional ctor field, threaded by manager at
   `manager.ts:69`), the reduced-motion fast paths (`scroll.ts:60-63,76-79,89,
   123,146-149`) delegate to `policy.interpolate`. Without a policy, current
   boolean behavior is untouched.
6. `packages/interaction/src/manager.ts` — add `motion?: MotionPolicy` to
   `InteractionManagerOptions` (anchor `manager.ts:27-43`); when present,
   `update(dt)` (`manager.ts:181-193`) uses `policy.mode !== 'continuous'`
   instead of the raw boolean at `manager.ts:189`.

**Runtime driver swap diagram (continuous ↔ reduced):**

```
            prefers-reduced-motion change (matchMedia, manager.ts:143-151)
                                  │
                    ┌─────────────▼─────────────┐
                    │  MotionPolicy (engine.ts) │  single owner
                    └──────┬───────┬───────┬────┘
        advanceTime()      │       │       │ interpolate()/quantizeScrub()
   ┌───────────────────────▼─┐   ┌─▼──────────────┐   ┌────────────────▼───┐
   │ frame loop elapsed      │   │ VirtualScroller│   │ Scrubber seeks     │
   │ (engine.ts:230)         │   │ (scroll.ts)    │   │ (scrub.ts:91-98)   │
   └─────────────────────────┘   └────────────────┘   └────────────────────┘
   continuous: elapsed += dt     continuous: lerp α     continuous: seek raw t
   reveal:     elapsed += dt     reveal: snap boundary  reveal: quantize to
   static:     hold t=0          static: jump instantly        section keyframe
   (driver kind unchanged — track.driver stays 'time'/'scroll'; only the
    interpolation policy switches, per frame, reversible at runtime)
```

**Behavior before→after.** Before: three independent boolean clamps
(`engine.ts:230`, `scroll.ts:60-63,76-79`, `manager.ts:62-67`) that drift
(scrubbed video still frame-seeks). After: one policy object; track/scene
`motion` overrides on the wire; all three sites + scrub agree.

**Tests** — new `packages/runtime/test/motion.test.mjs`: continuous default
byte-identical; `reveal` freezes lerp but advances time; `static` holds t=0;
per-track override beats scene default; quantizeScrub snaps to nearest
boundary; policy swap mid-run (reducedMotion toggles) takes effect next frame.
Extend `packages/interaction/test/scroll.test.mjs`: policy-driven scroller
equals legacy reduced-motion scroller output. Extend
`packages/runtime/test/ir.test.mjs`: v1 doc without `motion` validates;
doc with unknown `motion` value is tolerated (field ignored, not rejected —
validation stays structural only, `runtime/src/ir.ts:31-90`).

**Migration/compat.** Absent fields ⇒ `continuous`, byte-identical.
`meta`-smuggled hints (e.g. `cinematic-story.ts`) keep working; templates
migrate opportunistically. `BootOptions.reducedMotion` (`engine.ts:66-67`)
still overrides detection and maps to scene default `reveal` when no wire
fields exist.

---

## P2 — Variant array on `IRAssetRef`

`STATUS: approved-for-patch`

**Files to modify**

1. `contracts/src/ir.ts` — extend `IRAssetRef` (anchor `ir.ts:53-60`):

```ts
export interface IRAssetVariant {
  src: string;
  format?: string;             // 'avif' | 'webp' | 'mp4' | 'webm' | ...
  codec?: string;              // 'h264' | 'hevc' | 'av1' | 'vp9'
  width?: number;
  bytes?: number;
  delivery: 'progressive' | 'gop1' | 'frame-stack' | 'hls';
}
export interface IRAssetRef {
  id: string; src: string;
  kind: EngineConfig['assets'][number]['kind'];
  preload?: NonNullable<EngineConfig['assets'][number]['preload']>;
  duration?: number;
  /** Rich variants preserved across the wire; `src` remains the fallback. */
  variants?: IRAssetVariant[];
}
```

2. `packages/codegen/src/ir.ts` — asset lowering map (`ir.ts:91-96`): accept
   an optional manifest parameter (new optional 4th arg to `lowerToIR`,
   `ir.ts:62-66`, defaulting to `undefined`) and, when the manifest entry for
   `a.id` carries variants, populate `ref.variants`. When no manifest is
   passed, output is byte-identical to today.
3. `packages/runtime/src/ir.ts` — `manifestFromAssetRefs` (anchor
   `runtime/src/ir.ts:145-206`): at the top of the per-ref loop (`ir.ts:147`),
   add `if (ref.variants && ref.variants.length > 0)` → build the manifest
   entry from the variant array (image: `avif`/`webp` srcset + `fallback`;
   video: mp4/webm variants with real codec keys, `poster` from
   `format:'poster'` variant if present, `scrubOptimized` set **only** when a
   `delivery:'gop1'` variant exists — fixing the blind `scrubOptimized:true`
   at `runtime/src/ir.ts:174`). Absent `variants` → existing synthesis path
   unchanged.

**Behavior before→after.** Before: rich manifest variants
(`contracts/src/assets.ts`) collapse to `variants:{fallback:…}` /
`variants:{mp4:{codec:'h264'}}` at boot. After: variants cross the wire and
manifest synthesis is a faithful pass-through; fallback path untouched.

**Tests** — extend `packages/runtime/test/ir.test.mjs`: ref without
`variants` → legacy synthesis (snapshot equal to today); ref with variants →
manifest carries all variants; video with no `gop1` variant →
`scrubOptimized:false`; empty `variants:[]` treated as absent. Extend
`packages/codegen/test/codegen.test.mjs`: lowering without manifest is
byte-identical; lowering with manifest emits variants. Round-trip case
compose→lower→raise preserves variant count.

**Migration/compat.** Purely additive; old IR takes the synthesis path. Old
runtimes ignore `variants` and use `src` — which stays populated.

---

## P3 — Frame-stack scrub substrate via WebCodecs

`STATUS: plan-only` — **plan-only, no patch in phase 4** (hardware-decoder
behavior, iOS concurrent-decoder limits per Phase 1 §6, needs device-lab
validation). One *patchable* sub-fix may ride with phase 4 separately if the
lead approves: a seek generation counter in `createScrubber`
(`packages/runtime/src/scrub.ts:73-105`) dropping stale `seeked` resolutions
(out-of-order fire-and-forget seeks, `scrub.ts:91-98`), plus honest
`scrubOptimized` (lands with P2).

**Target architecture.**

```
                 ┌──────────────── LoadedVideo (contracts/src/assets.ts) ───────────────┐
                 │ seekTo(t): Promise<void> · onFrame(cb) · dispose()                    │
                 └───────▲───────────────────────────▲──────────────────────────────────┘
                         │                           │
        ┌────────────────┴─────────┐    ┌────────────┴───────────────────┐
        │ MediaElementVideo (today)│    │ FrameStackVideo (new, P3)      │
        │ loader.ts currentTime    │    │ VideoDecoder + ring buffer     │
        │ seeks; default backend   │    │ of N pre-decoded VideoFrames   │
        └──────────────────────────┘    │ around playhead ±window        │
                                        └────────────┬───────────────────┘
                                                     │ selected only when:
                              delivery:'gop1'|'frame-stack' (P2 variants)
                              AND VideoDecoder probe ok (capabilities codec
                              matrix, kernel/src/capabilities.ts)
                              AND decoder-budget policy allows (max 2
                              concurrent hw decoders on iOS → LRU demote
                              extra scrubbed videos back to MediaElement)
```

**Phases.** (1) Seek generation counter + `scrubOptimized` honesty
(patchable). (2) `FrameStackVideo` behind the unchanged `LoadedVideo`
interface for `delivery:'gop1'` mp4; demux via in-repo minimal mp4 box parser
(no new runtime dependency — hard constraint; evaluate `mp4box`-style parsing
in build pipeline instead, shipping pre-extracted samples as a `frame-stack`
asset). (3) Animated-WebP/AVIF frame-stack variant for short loops. (4)
Decoder-budget policy + LRU demotion, validated on device lab.

**Dependencies.** P2 (variants on the wire). P1 (scrub quantization semantics
must match under `reveal`). **Risks:** Safari `VideoDecoder` quirks;
`VideoFrame` memory pressure (explicit `close()` discipline in the ring);
demux cost; fallback correctness must be frame-identical to MediaElement
seeks. **Exit criteria:** scrub stutter on 2 s GOP encodes eliminated on
reference devices at ≤1 decoder stall per session.

---

## P4 — Kernel visibility policy + longtask attribution

`STATUS: approved-for-patch`

**Files to modify**

1. `contracts/src/kernel.ts` — add to `EngineEventMap` (anchor `kernel.ts:73-98`):
   `'engine:visibility': { state: 'hidden' | 'visible' };` (additive key; no
   existing key renamed).
2. `packages/kernel/src/kernel.ts` — at kernel construction (anchor: the bus
   and scheduler wiring around `kernel.ts:60-73`), register a guarded
   `visibilitychange` listener (`typeof document !== 'undefined' &&
   typeof document.addEventListener === 'function'`) that emits
   `bus.emit('engine:visibility', { state: document.visibilityState === 'hidden' ? 'hidden' : 'visible' })`;
   remove the listener in `dispose()`. No lifecycle-state changes — elapsed
   semantics unchanged (resume without time jump, per Phase 1 §3).
   In the same file, add a guarded `PerformanceObserver('longtask')` feed:
   entries >50 ms emit `bus.emit('scheduler:budget-exceeded', …)`? — **no**;
   instead emit a *new* report on the existing
   `'scheduler:budget-exceeded'` channel is wrong attribution. Emit on the
   existing typed map via `engine:error`? — also wrong. **Decision (additive):**
   extend `BudgetReport` with optional `source?: 'scheduler' | 'longtask'`
   (`contracts/src/kernel.ts:60-67`) and reuse
   `'scheduler:budget-exceeded'` with `source:'longtask'`, `phase:'external'`.
   The scheduler's own emission path (`kernel.ts:73`) passes no `source`
   (defaults to scheduler semantics).
3. `packages/runtime/src/engine.ts` — subscribe to `'engine:visibility'`
   right after `kernel.start()` (seam: `engine.ts:172-174`): while hidden,
   call `assets` preloader pause (add optional `pause()/resume()` to the
   preload plugin wrapper — see 4) and skip `scrubber.update` (seek queue
   sheds work). Dispose unsubscribes.
4. `packages/assets/src/preload.ts` — add optional `setPaused(on: boolean)`
   to the priority-queue driver (`preload.ts:47-101`): when paused, no new
   fetches are dequeued; in-flight fetches continue (aborting wastes bytes).

**Behavior before→after.** Before: zero `visibilitychange` handling; longtasks
from `innerHTML` writes (`renderer-dom.ts:239`) unattributed. After: hidden
tabs shed preload/seek work; >50 ms external tasks reach budget subscribers as
`source:'longtask'`, so the quality controller (P13) and ops telemetry react
to real jank. Scheduler internals (`scheduler.ts:104-149`) untouched.

**Tests** — extend `packages/kernel/test/kernel.test.mjs`: visibility event
emitted with correct payload; listener removed on dispose; longtask path
feature-guarded (no `PerformanceObserver` ⇒ no crash, no events);
`BudgetReport.source` defaults to undefined for scheduler-originated reports.
Extend `packages/assets/test/preload.test.mjs`: paused queue dequeues nothing,
in-flight completes, resume continues in priority order.

**Migration/compat.** New bus key + optional field only; plugins that don't
subscribe are unaffected. All DOM/observer access feature-guarded (Node-safe
import invariant from `engine.ts:14-15` preserved).

---

## P5 — Camera tracks actually drive the camera

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/runtime/src/engine.ts` — the only file with behavior change.
   - After `applyBindings` + `updateWorldTransforms()` (`engine.ts:237-239`),
     before building the draw list, resolve the camera:
     ```ts
     // resolved once per boot: id of the active scene's first 'camera' node
     const cameraNodeId = findFirstCameraNodeId(scene.graph.roots); // cached, R3
     // per frame:
     const camWorld = cameraNodeId ? scene.graph.getWorldTransform(cameraNodeId) : undefined;
     const camera: CameraState = camWorld
       ? { ...DEFAULT_CAMERA, position: camWorld.position, /* target from +Z of quat or meta.lookAt */ }
       : DEFAULT_CAMERA;
     ```
   - Replace `camera: DEFAULT_CAMERA` at `engine.ts:256-262` with
     `camera` above. Under P1's `reveal`/`static` policy, camera track
     playheads are already snapped by the policy (P1 quantizes; no special
     camera code needed beyond noting it).
2. `packages/scene/src/graph.ts` (or a small helper in `runtime`) —
   `findFirstCameraNodeId`: DFS for `kind === 'camera'`, memoized at boot
   (cache invalidated never — graphs are static post-raise).
3. Camera *target* derivation: read optional `meta.lookAt?: Vec3` on the
   camera node (additive convention, documented in `frame-adapter.ts` header
   comment block, `frame-adapter.ts:1-9`); default target =
   `position + forward(rotationQuat)`; fall back to `DEFAULT_CAMERA.target`.

**Camera evaluation path diagram:**

```
 rAF tick (scheduler priority 30, engine.ts:224-272)
   │ interaction.update(dt) → DriverMap {trackId → scalar}
   │ policy.advanceTime(elapsed, dt)                      (P1)
   │ resolvePlayheads(tracks, elapsed, {}) + driver merge (engine.ts:235-236)
   │ applyBindings(graph, tracks, playheads)              (engine.ts:237)
   │     └─ camera node's transform.* written by its track bindings
   │ scene.graph.updateWorldTransforms()                  (engine.ts:239)
   ▼
 resolveCamera(cachedCameraNodeId, graph)                 (NEW)
   │   camWorld ? CameraState{position: world.position,
   │                          target: meta.lookAt ?? quat-forward,
   │                          ...DEFAULT_CAMERA(fov/near/far/up)}
   │            : DEFAULT_CAMERA                          (engine.ts:92-99)
   ▼
 RenderFrame{ time, camera, drawList, post, clearColor }  (engine.ts:256-262)
   ▼
 renderer.renderFrame(frame, stats)  — WebGL/WebGPU consume frame.camera;
                                       canvas2d/dom pass it through (assertable)
```

**Behavior before→after.** Before: `RenderFrame.camera` is always the constant
`DEFAULT_CAMERA` (`engine.ts:258`); camera tracks evaluate into the void
(`frame-adapter.ts:89-90` returns null for cameras — preserved, cameras still
emit no draw call). After: a scene with a bound camera node drives
`frame.camera`; scenes without one get byte-identical frames.

**Tests** — new `packages/runtime/test/camera.test.mjs`: no camera node ⇒
`DEFAULT_CAMERA` identity (deep equal); camera node with `transform.position`
binding ⇒ rendered frame camera matches evaluated world position across three
playhead values; `meta.lookAt` honored; two camera nodes ⇒ first DFS wins and
is cached (graph traversal count = 1 over N frames via instrumented helper).

**Migration/compat.** Pure runtime evaluation; no IR change; no renderer
interface change (`RenderFrame.camera` already exists,
`contracts/src/rendering.ts:75`).

---

## P6 — Minimal post-pass executor

`STATUS: plan-only` — **plan-only, no patch in phase 4** (GPU-dependent visual
validation; pairs with the WebGPU renderer plan).

**Target architecture.**

```
 RenderFrame.post: PostProcessPass[]  (contracts/src/rendering.ts:63,79)
        │ names match quality.getLevel().postPasses (quality.ts:126)
        ▼
 ┌──────────────────────── PostPassRegistry (new, rendering pkg) ────────────────┐
 │ register(name, executor) · executors: per-backend map                          │
 │   webgl2:  { bloom, grain, vignette, dof }  → ping-pong two-target chain       │
 │   canvas2d/dom: none (inert, as today)      webgpu: (with WebGPU renderer)     │
 └──────────────────────────────┬────────────────────────────────────────────────┘
                                ▼
 WebGLRenderer.renderFrame (renderer-webgl.ts): scene draw → for each post name
   with an executor: bind alternate target, run pass program, swap.
   Unknown names: no-op (preserves today's inert behavior).
 Quality ladder (P13) sheds passes right-to-left → registry order = shed order.
```

**Phases.** (1) Registry + no-op plumbing behind `RenderFrame.post` (pure,
testable headless). (2) WebGL2 ping-pong target management + `grain`/`vignette`
(single-quad fragment passes). (3) `bloom` (downsample chain) + `dof`
(needs depth — gated on WebGL renderer depth attachment). (4) Port executors
to WebGPU renderer when it lands.
**Dependencies:** none blocking; P13 gains visible effect once (2) lands.
**Risks:** shader compile cost at boot (precompile during `init`); render-target
memory on low-end (reuse two targets sized by `dprScale`); visual regression
validation is manual/GPU-bound. three.js remains an optional peer; passes
should use raw WebGL2 to honor "no new runtime dependencies".

---

## P7 — Capability-aware variant selection

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/assets/src/variants.ts` — **new file**, pure and testable like
   `rendering/src/select.ts`:
   ```ts
   import type { CapabilityProfile, IRAssetVariant } from '@lumen/contracts';
   export function pickVariant(
     profile: CapabilityProfile | undefined,
     variants: readonly IRAssetVariant[],
     kind: 'image' | 'video',
   ): IRAssetVariant | undefined; // codec support → deviceMemory class → dpr width fit
   ```
   Order: filter by `profile.codecs[codec].supported` (video) / format
   support (image), then drop variants whose `width` exceeds
   `dpr.current * viewport` class when `deviceMemoryGB <= 4`, then widest
   remaining ≤ 2× viewport, else first. `profile === undefined` ⇒ `undefined`
   (caller falls back to today's static path).
2. `packages/runtime/src/engine.ts` — `assets.init` call site
   (`engine.ts:143-147`): add `capabilities: kernel.capabilities` to the
   options object. The plumbing mismatch was "one argument wide" (Phase 1 §7).
3. `packages/assets/src/loader.ts` — extend the asset-manager init options
   type with `capabilities?: CapabilityProfile`; in the image path
   (`pickImageUrl`, `loader.ts:82-96`) and video variant choice
   (`loader.ts` scrub/progressive preference), when the manifest entry was
   built from P2 variants (mark entries with a non-enumerable flag or a
   `fromVariants: true` optional manifest field) call `pickVariant` first;
   fall back to existing logic otherwise.

**Behavior before→after.** Before: avif→webp srcset preferred blindly; video
chosen by scrub flag only; the probed HEVC/AV1 matrix
(`capabilities.ts`) unused by the loader. After: variant choice is
capability-driven and deterministic.

**Tests** — new `packages/assets/test/variants.test.mjs`: codec filter drops
hevc when unsupported; deviceMemory≤4 prefers smaller width; dpr fit picks
1× vs 2×; undefined profile ⇒ undefined (fallback preserved); determinism
(same inputs ⇒ same variant, two runs).

**Migration/compat.** Options field optional; no IR change beyond P2; absent
profile ⇒ today's static preference order exactly.

---

## P8 — Version-skew fallback to SSR skeleton

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/codegen/src/gen-static.ts` — in the scene-section emitter
   (`gen-static.ts:30-47`), add `data-lumen-skeleton="1"` to the first scene's
   `<section>` when `ssr && i === 0` (the branch already emitting
   `ssrSkeleton`, `gen-static.ts:41-42`). Emission-only.
2. `packages/runtime/src/engine.ts` — `parseSceneIR` (`engine.ts:102-109`)
   currently throws on `describeSceneIRError` mismatch. Split handling: when
   the problem string starts with `'SceneIR version mismatch'` (from
   `runtime/src/ir.ts:34-36`), call a new `tryStaticFallback(rootElement)`:
   if `rootElement.querySelector('[data-lumen-skeleton]')` exists → emit
   `engine:error` `{ module:'runtime', code:'IR_VERSION_SKEW', recoverable:true,
   cause:{ expected, got, minRuntime } }` on a *temporary* local bus — simplest:
   throw a typed `VersionSkewError` from `parseSceneIR`, catch it in
   `bootEngine` before `createKernel`, create the kernel solely to emit the
   error, and return early with a **disposed-but-readable** state: leave the
   skeleton DOM untouched, do not set `dataset.lumenBooted`, and throw the
   typed error for programmatic callers (white screen avoided because the SSR
   HTML was never removed). Only when no skeleton exists does the original
   hard throw path run unchanged.
3. `contracts/src/ir.ts` — optional `minRuntime?: string` on `SceneIR`
   (anchor `ir.ts:66-92`), advisory, surfaced in the error payload to speed
   ops diagnosis.

**Behavior before→after.** Before: version mismatch = hard throw
(`runtime/src/ir.ts:34-36`) → stale cached HTML + new runtime = white screen.
After: if a codegen-marked skeleton exists, the static, aria-labeled page
stays readable/crawlable and the failure is observable on the bus; otherwise
behavior identical.

**Tests** — extend `packages/runtime/test/ir.test.mjs`: mismatch without
skeleton ⇒ same throw as today; typed `VersionSkewError` carries
expected/got/minRuntime. New jsdom-free DOM-stub case in
`packages/runtime/test/` (follow `engine.ts` guard patterns): mismatch with
skeleton element ⇒ no DOM removal, error emitted. Extend
`packages/codegen/test/codegen.test.mjs`: static HTML contains
`data-lumen-skeleton` on first scene only.

**Migration/compat.** Failure-mode-only; success paths untouched.

---

## P9 — Unified scroll input path + restoration

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/interaction/src/scroll.ts` — introduce a single normalized entry:
   ```ts
   /** Single entry for ALL absolute progress writes (native scroll, restoration). */
   setTargetFromNormalized(p: number): void {
     if (!this.enabled) return;
     this.target = clamp01(p);          // same clamp as feedDelta path
     if (this.reducedMotion) { this.current = this.target; this.onProgress?.(this.current); }
   }
   ```
   and rewrite `attach()`'s `onScroll` (`scroll.ts:140-150`) to call
   `this.setTargetFromNormalized(clamp01(el.scrollTop / max))` instead of
   writing `this.target` directly (the asymmetry: attach bypassed
   `wheelMultiplier`/clamp conventions, `scroll.ts:145`). `feedDelta`
   (`scroll.ts:73-80`) stays the relative-delta entry; both now converge on
   identical state transitions.
2. Scroll restoration in `scroll.ts` + `manager.ts`: add optional
   `restorationKey?: string` to `VirtualScrollerOptions`
   (`scroll.ts:13-26`). When set and `history`/`popstate` exist: on snap
   settle (the settle branch, `scroll.ts:94-101`) and not more than once per
   500 ms, `history.replaceState({ ...history.state, lumenScroll:
   { [restorationKey]: this.current } }, '')`; on `popstate`, re-feed via
   `setTargetFromNormalized(state.lumenScroll[key])` and emit through
   `onProgress` so the DriverMap (`manager.ts:181-193`) republishes the
   restored progress next frame. Under P1 reduced motion both paths already
   converge on instant jumps.

**Unified scroll input state machine:**

```
        wheel/touch deltas            native scrollTop           popstate
              │                            │                        │
              ▼                            ▼                        ▼
   feedDelta(Δp) (scroll.ts:73)   attach onScroll (138-153)   restoration handler
   target += Δp*wheelMultiplier        │                        │
              │                        ▼                        ▼
              │              setTargetFromNormalized(p)  ◄──────┘
              └───────────────►  target = clamp01(p)   (single write seam)
                                 │
                    update(dt) once per frame (scroll.ts:87-105)
              continuous: lerp α=1-(1-s)^frames → converge → snap settle
              reduced:    jump (P1 policy.interpolate)
                                 │  on settle: history.replaceState (≥500ms)
                                 ▼
                     onProgress → manager.update → DriverMap → engine merge
```

**Behavior before→after.** Before: two input paths with divergent semantics
feeding one state; browser-back restores scroll but not scene state. After:
one write seam; scene state survives history navigation.

**Tests** — extend `packages/interaction/test/scroll.test.mjs`: native-path
write equals delta-path write given same logical input (property-style case);
reduced-motion jump parity; restoration round-trip (feed → settle → state
written → popstate → progress restored); throttle: 5 settles in 200 ms ⇒ ≤1
replaceState; no `history` global ⇒ no-op. Extend
`packages/interaction/test/manager.test.mjs`: restored progress appears in
`update()` DriverMap.

**Migration/compat.** Internal behavior fix; public API and DriverMap shape
unchanged; `restorationKey` absent ⇒ no history writes (today's behavior).

---

## P10 — Per-compose id context

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/templates/src/internal.ts` — replace the module-global counter
   (`internal.ts:31-41`) with:
   ```ts
   export interface ComposeContext { nextId(prefix: string): string; readonly seed: number; }
   export function createComposeContext(seed = 0): ComposeContext {
     let counter = seed;
     return { seed, nextId: (p) => `${p}-${++counter}` };
   }
   const defaultCtx = createComposeContext();
   export function nextId(prefix: string): string { return defaultCtx.nextId(prefix); }
   export function resetIds(): void { /* re-init defaultCtx counter to 0 */ }
   ```
   Keep `nextId`/`resetIds` signatures identical (thin wrappers over a default
   context) so existing template code compiles unchanged.
2. Template files (e.g. `scroll-cinema-landing.ts:126` and siblings) —
   opportunistic migration: each `compose()` creates
   `const ctx = createComposeContext()` first and threads it to helpers; not
   required for correctness of sequential builds.

**Behavior before→after.** Before: deterministic per call but not reentrant —
parallel/worker builds interleave ids. After: per-compose contexts are
isolated; sequential single-threaded builds produce byte-identical IR.

**Tests** — extend `packages/templates/test/registry.test.mjs` (or new
`compose-context.test.mjs`): two interleaved composes via explicit contexts
produce non-interleaved ids; legacy `resetIds()+nextId()` sequence unchanged;
full-template IR snapshot equality vs. pre-patch fixture
(`packages/templates/test/fixtures.mjs`).

**Migration/compat.** Additive API; generated IR byte-identical for
sequential builds.

---

## P11 — DOM layer richness: stacking contexts + full transforms + rect policy

`STATUS: approved-for-patch`

**Files to modify**

1. `contracts/src/scene.ts` + `contracts/src/ir.ts` — additive payload/IR
   fields: `DomPayload.rect?: {x,y,width,height}` and
   `DomPayload.layerGroup?: string` (anchor `scene.ts:54-59`);
   `IRNode.anchor?: Vec3`, `IRNode.rect?`, `IRNode.layerGroup?: string`
   (anchor `ir.ts:21-38`).
2. `packages/codegen/src/ir.ts` — `lowerNode` (`ir.ts:29-47`): pass the new
   payload fields through (`anchor` is currently **dropped** — Phase 1 §2;
   add `if ('anchor' in payload) ir.anchor = payload.anchor;` etc.).
3. `packages/runtime/src/ir.ts` — `raiseNode` (`runtime/src/ir.ts:93-120`):
   re-materialize the fields into `DomPayload`.
4. `packages/rendering/src/frame-adapter.ts` —
   (a) Rect policy: in `drawCallForNode` (`frame-adapter.ts:44-49`), prefer
   an explicit payload rect; fall back to `surface - world.position` only
   when absent (makes width/height animatable — bindings can write
   `payload.rect.width` via the existing `setByPath`,
   `scene/src/binding.ts:27-38`).
   (b) Transform mapping: extend `cssTransform` (`frame-adapter.ts:28-32`)
   to emit `matrix3d(...)` when `rotationQuat` is non-identity (compose
   quat→matrix in `scene/src/math.ts` style), else keep today's
   `scale(x,y)` string bit-for-bit.
   (c) Include `layerGroup` in the dom payload emitted at
   `frame-adapter.ts:51-63`.
5. `packages/rendering/src/renderer-dom.ts` — pooled stacking contexts: keep
   the flat pool (`renderer-dom.ts:176-195`) but add a small `Map<string,
   HTMLElement>` of group `<div>`s (created lazily per distinct `layerGroup`,
   `position:absolute; inset:0; pointer-events:none`, `z-index` = min layer of
   the group). In `renderFrame` (`renderer-dom.ts:221-258`), append pooled
   elements to their group div instead of `root` when the payload names a
   group (`renderer-dom.ts:256`); `el.style.zIndex` (`renderer-dom.ts:249`)
   becomes group-relative. No group ⇒ element appended to `root` exactly as
   today.

**Stacking-context model diagram:**

```
 root overlay (renderer-dom.ts:164-173, z:auto)                 canvas sibling
 ├── [ungrouped pooled elements]   zIndex = call.layer   (today's behavior)
 ├── <div data-layer-group="video">     z-index: 0   ── stacking context
 │      └─ pooled video elements  zIndex = layer (group-relative)
 ├── <div data-layer-group="chapters">  z-index: 10  ── stacking context
 │      └─ caption/chapter dom
 ├── <div data-layer-group="hero">      z-index: 20
 └── <div data-layer-group="logo">      z-index: 30
 Two-level typed ordering replaces the global z-index integer convention
 (video 0 / chapters 10 / hero 20 / logo 30) that no type enforced.
```

**Behavior before→after.** Before: flat overlay, translate3d+scale only,
invented rects. After: typed two-level stacking, rotation reaches CSS via
`matrix3d`, rects are authorable/animatable. Absent fields ⇒ CSS output
bit-for-bit identical (the `lastCss` diff key at `renderer-dom.ts:244-245`
already includes the transform string, so R4 is covered).

**Tests** — extend `packages/rendering/test/dom-transform.test.mjs`:
identity quat ⇒ legacy `scale()` string; rotateZ quat ⇒ `matrix3d` containing
cos/sin terms; explicit rect preferred over derived; grouped payload ⇒
element parented to group div with correct group z-index; ungrouped ⇒
unchanged (snapshot). Extend `packages/runtime/test/ir.test.mjs`:
anchor/rect/layerGroup round-trip lower→raise.

**Migration/compat.** All fields optional; templates opt in.

---

## P12 — a11y hydration + live-region announcer

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/runtime/src/engine.ts` — `hydrateIslands()`
   (`engine.ts:325-336`): after locating each island element
   (`engine.ts:331`), look up `engine.ir.a11y[sceneId]`; when present apply
   `aria-label` (matching codegen's SSR output at `gen-static.ts:36`) and,
   when `summary` exists, ensure a `.lumen-visually-hidden` description node
   (idempotent: skip if one is already present from SSR,
   `gen-static.ts:43-44`). Absent entries ⇒ today's behavior.
2. Live-region announcer (same file, new exported helper
   `createA11yAnnouncer(engine, rootElement)`): appends one
   `aria-live="polite"` visually-hidden div; subscribes to `scene:next` /
   `scene:prev` (`engine.ts:213` maps them) and `scene:enter`
   (`contracts/src/kernel.ts:87`), announcing the target scene's
   `a11y[sceneId].label`. Under P1 `reveal`/`static`, snap transitions are
   announced as discrete state changes. Unsubscribe + node removal on
   dispose.

**Behavior before→after.** Before: `SceneIR.a11y` (`contracts/src/ir.ts:91`)
dead at runtime; islands hydrate without aria wiring. After: hydration
re-applies labels idempotently; scene changes are announced.

**Tests** — new `packages/runtime/test/a11y.test.mjs` (DOM stubbed per
existing guard patterns): island with a11y entry gets `aria-label`; re-run is
idempotent (single description node); missing entry ⇒ no attributes;
announcer updates live region text on `scene:enter` with the scene label.

**Migration/compat.** Reads existing wire data; SSR output unchanged.

---

## P13 — Decoupled quality ladder axes

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/rendering/src/quality.ts` — only file. Keep
   `AdaptiveQualityController`, EMA/hysteresis/cooldown logic
   (`quality.ts:87-120`) and `QualityLevel` shape
   (`contracts/src/rendering.ts:85-94`) untouched. Replace the fixed
   `LADDER` (`quality.ts:39-46`) with a **generated** expanded ladder:
   ```ts
   interface QualityRung { dprScale: number; msaa: 0|2|4|8; shadowMapSize?: number; postKeep: number; }
   // buildLadder(): walk old LADDER top→bottom; between each adjacent pair,
   // insert single-axis intermediate rungs in shed order:
   //   post-pass (right-to-left) → msaa↓ → shadows↓ → dpr↓ (one axis per rung)
   export function buildLadder(base: readonly QualityRung[] = LADDER_V1): readonly QualityRung[];
   ```
   so dpr and MSAA move independently and post shedding drops one pass at a
   time instead of the all-or-one logic at `quality.ts:126`. `getLevel()`
   (`quality.ts:123-130`) then reads `rung.postKeep` for
   `postPasses = allPostPasses.slice(0, postKeep)`. The min/max window math
   (`quality.ts:71-81`) operates on the expanded table but is anchored by
   dprScale, unchanged.
2. Export `LADDER_V1` (the current 6 rungs) as a preset so embedders can
   restore old behavior via a new optional `AdaptiveQualityOptions.ladder`
   field (default: expanded).

**Decoupled-axes diagram:**

```
 old rung k+1 {dpr 1.5, msaa 4, shadow 2048, post: all}
        │  (expanded: one axis sheds per rung)
        ├─ rung: drop last post-pass        (postKeep: n → n-1)
        ├─ rung: msaa 4 → 2                 (dpr held)
        ├─ rung: shadow 2048 → 1024         (dpr held)
        ├─ rung: dpr 1.5 → 1.25             (msaa held)
 old rung k   {dpr 1.25, msaa 2, shadow 1024, post: keep 1}
        … controller index/hysteresis/cooldown identical; longer ladder only
```

**Behavior before→after.** Before: 6 rungs move dpr+MSAA together; post
shedding all-or-one. After: the controller traverses a longer single-axis
ladder; renderers see the same `QualityLevel` object; bus event
(`engine.ts:265-268`) unchanged. P6's registry later makes per-pass shedding
visible; today the pass names remain inert strings (harmless).

**Tests** — extend `packages/rendering/test/quality.test.mjs`: expanded
ladder contains the old 6 rungs as a subsequence with identical
`{dprScale, msaa, shadowMapSize}` (R6); consecutive `update` overruns shed
exactly one axis per step; `postKeep` decreases by one per post rung;
`ladder: LADDER_V1` preset reproduces today's exact rung sequence and
`getLevel()` outputs; window clamping with `maxDpr` unchanged.

**Migration/compat.** `QualityLevel` and `IRenderer.setQuality` untouched.

---

## P14 — Optional-plugin degradation

`STATUS: approved-for-patch`

**Files to modify**

1. `contracts/src/kernel.ts` — add `readonly optional?: boolean;` to
   `LumenPlugin` (anchor `kernel.ts:101-114`).
2. `packages/kernel/src/plugin.ts` — in `initAll` (`plugin.ts:114-143`),
   the failure branch (`plugin.ts:139-141`): before rethrowing, check
   `plugin.optional === true`. If optional:
   - emit `engine:error` with `recoverable: true` (the existing
     `options.onError` path already fired; adjust the `guardAsync` options at
     `plugin.ts:122-131` to use `recoverable: plugin.optional === true`),
   - compute whether any *other* registered plugin `consumes` a token this
     plugin `provides` (providers map already built by `resolvePluginOrder`,
     `plugin.ts:29-53`); if yes → still throw (fail fast, unmet mandatory
     dependency); if no → `continue` boot without pushing to `initialized`.
   Dispose semantics unchanged (`disposeAll`, `plugin.ts:144-157`, only
   touches initialized plugins).

**Behavior before→after.** Before: all init failures abort boot. After:
optional plugins degrade gracefully when nothing depends on their tokens;
mandatory plugins (default) keep identical failure semantics.

**Tests** — extend `packages/kernel/test/kernel.test.mjs`: optional plugin
throwing in init ⇒ boot completes, `engine:error` emitted with
`recoverable:true`, plugin absent from order effects; optional plugin whose
token is consumed by another plugin ⇒ boot still aborts; mandatory plugin
failure ⇒ unchanged abort; dispose of a skipped optional plugin is never
called.

**Migration/compat.** Descriptor field optional; existing plugins mandatory
by default.

---

## P15 — Track segments, keyframe bezier, driver smoothing descriptor

`STATUS: approved-for-patch`

**Files to modify**

1. `contracts/src/scene.ts` — additive fields:
   `Keyframe.easingBezier?: CubicBezier` (anchor `scene.ts:95-102`; the bezier
   machinery already exists — `applyEasing` accepts `CubicBezier`,
   `scene/src/timeline.ts:72-73`);
   `TimelineTrack.smoothing?: { mode: 'lerp' | 'spring' | 'none'; stiffness?: number; damping?: number }`
   and `TimelineTrack.segments?: TrackSegment[]` where
   `TrackSegment = { id: string; from: number; to: number; keys: Keyframe[] }`
   (anchor `scene.ts:105-116`).
2. `contracts/src/ir.ts` — mirror the same optional fields on `IRTrack`
   (anchor `ir.ts:41-47`).
3. `packages/codegen/src/ir.ts` — extend the track lowering map
   (`ir.ts:83-89`) to pass all three fields (R1). For **forward compat**
   (old runtime + new IR), when `easingBezier` is present codegen *also*
   writes the nearest `EasingName` into legacy `easing` — old runtimes
   degrade to the named easing, never crash.
4. `packages/scene/src/timeline.ts` — in `interpolateKeyframes`
   (`timeline.ts:144-149`), prefer `a.easingBezier` over the named
   `a.easing` when present; binding-level override still wins
   (`binding.ts:90-93` unchanged). Add `resolveSegments(track)`: when
   `segments` is present, evaluation flattens the referenced segment keys
   into the track's keyframe stream (cached per track) before interpolation;
   absent ⇒ today's sparse-keyframe path.
5. `packages/interaction/src/manager.ts` + `scroll.ts` — consume
   `smoothing`: the manager maps per-track `smoothing` onto the scroller for
   scroll-driven tracks (per-track lerp factor vs. the single global
   `scroll.ts:43` constant); `mode:'spring'` integrates with the frame-rate
   compensated `dt*60` convention already used at `scroll.ts:90-92`;
   `mode:'none'` = snap. P1's policy forces `mode:'none'` when the resolved
   track mode is `reveal`/`static` — read policy if injected, else the
   legacy boolean.

**Behavior before→after.** Before: 4-keyframe fade/hold/fade duplicated per
caption track; bezier authored on keyframes can't survive the wire; one
global lerp. After: reusable segments, wire-faithful bezier, per-track
driver interpolation as data. Absent fields ⇒ evaluation identical (named
easing path, global smoothing).

**Tests** — extend `packages/scene/test/timeline.test.mjs`: bezier keyframe
matches `cubicBezierEase` reference at t=0/.25/.5/.75/1; binding override
still beats keyframe bezier; segments flatten to expected keyframe stream;
segment + inline keys merge order deterministic. Extend
`packages/interaction/test/scroll.test.mjs`: per-track spring converges
frame-rate-independently at 60 vs 120 Hz; `mode:'none'` snaps. Extend
`packages/runtime/test/ir.test.mjs`: v1 fixture without new fields evaluates
identically; unknown-field tolerance.

**Migration/compat.** All optional; codegen's named-easing fallback keeps
old runtimes functional on new IR.

---

## P16 — Bandwidth estimation + Save-Data awareness

`STATUS: plan-only` — **plan-only, no patch in phase 4** (EMA windows and
demotion thresholds need lab + RUM data; untuned throttling is worse than
none).

**Target architecture.**

```
 navigator.connection (effectiveType, saveData) ──┐
 timed fetchBytes completions (assets fetch path)─┤
                                                  ▼
                              ┌──────────────── NetworkMonitor ────────────────┐
                              │ probes: saveData: boolean                      │
                              │         effectiveType: '4g'|'3g'|'2g'|'slow-2g'│
                              │ rolling throughput EMA (KB/s, window TBD-RUM)  │
                              └───────┬───────────────────────┬────────────────┘
                bandwidth class       ▼                       ▼
        (low|med|high)     Preloader policy hook      pickVariant input (P7)
                           (preload.ts:47-101):       variants sorted by bytes
                           demote 'high'→'lazy' on    (P2 carries bytes per
                           constrained links;         variant, so class→width/
                           never demote 'critical'    delivery choice is data)
```

New optional `network` facet on `CapabilityProfile`
(`contracts/src/kernel.ts:28-45`, additive field next to `deviceMemoryGB`),
probed at kernel boot and refreshed on `connection.change`.

**Phases.** (1) Probe + profile facet only (no behavior change; telemetry
emitted on the bus for RUM collection). (2) Preload demotion policy behind a
default-off option, tuned with RUM data. (3) `pickVariant` bandwidth input
(P7 seam — one more sort key). **Dependencies:** P2 (variant `bytes`), P7
(selection seam), P4 (visibility pausing composes with throttling).
**Risks:** `navigator.connection` is Chromium-only (guarded fallback =
current static behavior); EMA lag on bursty links; demoting too eagerly
hurts LCP — hence telemetry-first phase.

---

## P17 — Poster/SSR fallback for canvas-only nodes

`STATUS: approved-for-patch`

**Files to modify**

1. `packages/codegen/src/common.ts` — `ssrSkeleton` (`common.ts:184-211`):
   the `video-plane | sprite | mesh` branch (`common.ts:196-200`) currently
   emits an empty `role="img"` div. Extend it: when the asset id resolves to
   a manifest entry with a `poster` (or a P2 `delivery:'gop1'|'frame-stack'`
   first frame), emit `<img src="…poster" alt="…scene label"
   data-lumen-poster="nodeId">` inside the div, preserving the existing
   `data-node`/`aria-label` attributes. Layer order follows document order,
   matching the runtime overlay. No poster ⇒ today's empty div unchanged.
   `ssrSkeleton` needs manifest access: add an optional third parameter
   `manifest?: AssetManifest`; the `gen-static.ts:42` call site passes it
   through (additive signature change).
2. `packages/runtime/src/engine.ts` — one optional removal step: after the
   renderer's first successful `renderFrame` (frame loop,
   `engine.ts:263`), remove matching `[data-lumen-poster]` elements for
   nodes present in the draw list (one-time, guarded by a `postersCleared`
   flag). Also serves as P1 `static` mode's visible poster (policy leaves
   them in place when scene default is `static`) and P8's fallback surface.
3. Bus event (additive key on `EngineEventMap`,
   `contracts/src/kernel.ts:73-98`):
   `'render:first-frame': { backend: string }` — emitted once; hydration
   listens and removes poster fallbacks.

**Behavior before→after.** Before: canvas-only nodes emit no crawlable
markup (`common.ts:196-200`). After: posters double as SEO content,
version-skew fallback (P8), and static reduced-motion surface (P1).

**Tests** — extend `packages/codegen/test/codegen.test.mjs`: node with
poster asset ⇒ `<img>` with alt = scene label; node without ⇒ legacy empty
div; document order matches node order. Runtime: first frame removes
posters; `static` policy retains them; event fires exactly once.

**Migration/compat.** Emission-only in codegen plus one optional runtime
removal step; pages without posters byte-identical.

---

## Summary

| P# | Status | Primary files |
|----|--------|---------------|
| P1 | approved-for-patch | contracts/ir.ts, codegen/ir.ts, runtime/motion.ts(new), runtime/engine.ts, interaction/{scroll,manager}.ts |
| P2 | approved-for-patch | contracts/ir.ts, codegen/ir.ts, runtime/ir.ts |
| P3 | **plan-only, no patch in phase 4** | (future) assets/loader.ts backend |
| P4 | approved-for-patch | contracts/kernel.ts, kernel/kernel.ts, runtime/engine.ts, assets/preload.ts |
| P5 | approved-for-patch | runtime/engine.ts (+ camera helper) |
| P6 | **plan-only, no patch in phase 4** | (future) rendering registry + renderer-webgl.ts |
| P7 | approved-for-patch | assets/variants.ts(new), runtime/engine.ts, assets/loader.ts |
| P8 | approved-for-patch | codegen/gen-static.ts, runtime/engine.ts, contracts/ir.ts |
| P9 | approved-for-patch | interaction/scroll.ts, interaction/manager.ts |
| P10 | approved-for-patch | templates/internal.ts |
| P11 | approved-for-patch | contracts/{scene,ir}.ts, codegen/ir.ts, runtime/ir.ts, rendering/{frame-adapter,renderer-dom}.ts |
| P12 | approved-for-patch | runtime/engine.ts |
| P13 | approved-for-patch | rendering/quality.ts |
| P14 | approved-for-patch | contracts/kernel.ts, kernel/plugin.ts |
| P15 | approved-for-patch | contracts/{scene,ir}.ts, codegen/ir.ts, scene/timeline.ts, interaction/{manager,scroll}.ts |
| P16 | **plan-only, no patch in phase 4** | (future) kernel/capabilities.ts, assets/preload.ts |
| P17 | approved-for-patch | codegen/common.ts, codegen/gen-static.ts, runtime/engine.ts, contracts/kernel.ts |

No plan changed approval status from Phase 2: 14 approved-for-patch,
3 plan-only (P3, P6, P16). All patches are additive against SceneIR v1, keep
`SCENE_IR_VERSION = 1`, add no runtime dependencies, and preserve every
invariant named in Phase 1 (contracts-first rule, deep IR validation, pure
selection functions, pool-and-diff DOM renderer, quality hysteresis, scrub
throttle).
