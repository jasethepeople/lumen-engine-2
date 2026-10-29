# Lumen Engine — Evolution v2 Consolidation

*Senior-architect consolidation of the v1.1 evolution cycle. Sources:
`docs/stabilization-report.md`, `docs/refactor-changelog.md` (C1–C9), and
`docs/analysis/phase1-…phase5`. This document is summaries only; code lives in
`phase4-code-patches.diff` and the commits it cites.*

---

## 1. Evolution narrative

**v1 — founding architecture.** Lumen shipped as an 11-package monorepo behind
a frozen contracts package: config → template `compose()` → `ComposedScene` →
codegen lowers to SceneIR v1 (versioned JSON, `SCENE_IR_VERSION = 1`) → runtime
validates, raises, and boots a kernel-driven frame loop (interaction →
playheads → bindings → scrub → world transforms → draw calls → render →
quality). The center of gravity was exactly right — a serializable scene
document, a driver-agnostic timeline, a renderer-agnostic draw list — with
deep IR referential validation, a pure capability→renderer selection chain
(webgpu → webgl2 → canvas2d → dom), a pool-and-diff DOM renderer, an
EMA/hysteresis quality controller, and a throttled video scrubber. Six
templates and three examples shipped on top.

**Stabilization (v0.2, merged `0accb2b`).** A QA hardening pass closed
operational holes without touching architecture: NaN-duration scrub guards,
plugin-init failures rejecting boot, half-attached boot cleanup, WebGL
context-loss/resource disposal, import maps + vendored runtimes for browser
resolution, iOS gesture-gated orientation and `100dvh` fixes, touch input to
the virtual scroller, manifest/loader edge guards, and template range
clamping. Exit gate: 12 compilations clean, 214 package tests + 8 e2e green,
all three examples within budgets. Three items were documented-deferred
(CORS image fallback, SSR trust model, mid-ladder quality start).

**Refactor (C1–C9 consolidation).** A structural hygiene pass that unified
the build convention (one tsconfig shape, one package.json contract), moved
SceneIR ownership into `contracts` (C2), consolidated theme helpers (C3),
resolved the `ValidationResult` export collision (C4), cleaned the root
index (C5), relocated the frame adapter into rendering (C6), documented the
navigation hook (C7), aligned naming (`kernel.boot()` deprecated for
`start()`, C8), and consolidated template structural assertions (C9). No
behavior change; it squared the seams the later evolution would attach to.

**v1.1 — audit → evolution (W1–W17 → P1–P17).** Phase 1's principal-engineer
audit produced a 17-item weakness register concentrated at three seams: the
wire format was thinner than the runtime's own manifest (variants, a11y,
reduced-motion thrown away at build time), time was privileged over
interaction (boolean reduced-motion clamps at three sites, constant camera,
last-write-wins driver merge), and the GPU half was a facade (constant
camera, inert post-pass strings). Phase 2 mapped each weakness to an
additive proposal on an existing seam; Phase 3 planned all 17 with 14
approved-for-patch and 3 plan-only (P3, P6, P16). Phase 4 landed all 14 in
the order P10 → P2 → P7 → P1 → P15 → P5 → P11 → P13 → P9 → P4 → P14 → P12 →
P17+P8. Phase 5 independently validated the result at `master @ a4e83ae`:
**PASS-WITH-NOTES** — clean-slate rebuild green, 331 package tests + 8 e2e =
339/339, SceneIR v1 documents parse unchanged, 208 root exports intact, all
three examples rebuild within budgets with `data-lumen-skeleton` markup.

---

## 2. Subsystem maps

### IR delta (v1 → v1.1)

All changes are additive optional fields; `SCENE_IR_VERSION` stays `1`. Old
runtimes ignore unknown keys (validation checks structural invariants only).

| Field | Type (optional) | Plan | Wire-compat note |
|---|---|---|---|
| `IRTrack.motion` | `'continuous' \| 'reveal' \| 'static'` | P1 | Absent = `continuous`, byte-identical |
| `SceneIR.a11y[sceneId].motion` | same enum (scene default) | P1 | Reads existing wire record |
| `IRAssetRef.variants` | `IRAssetVariant[]` (`src/format/codec/width/bytes/delivery`) | P2 | Absent → legacy manifest synthesis path |
| `IRNode.anchor` | `Vec3` | P11 | DomPayload anchor now survives serialization |
| `IRNode.layerGroup` | `string` | P11 | Absent → flat z-index pool as today |
| `IRNode.rect` | `{x,y,width,height}` | P11 | Absent → `surface - world.position` fallback |
| `IRTrack.smoothing` | `{mode:'lerp'\|'spring'\|'none', stiffness?, damping?}` | P15 | Passed to driver only when present |
| `IRTrack.segments` | `Array<{id, from, to, keys}>` | P15 | Flattened to keyframes; legacy passthrough |
| `Keyframe.easingBezier` | `CubicBezier` alongside named `easing` | P15 | Old runtimes degrade to nearest named easing |
| `SceneIR.minRuntime` | `string` (advisory) | P8 | Error-payload hint only, never required |

### Kernel delta

| Change | Plan | Note |
|---|---|---|
| `engine:visibility` bus event on `visibilitychange` | P4 | DOM-guarded for Node; elapsed semantics unchanged |
| Longtask attribution via `PerformanceObserver('longtask')` | P4 | Feature-guarded; emits budget-exceeded with `source: 'longtask'`, `phase: 'external'` |
| `BudgetReport.source` distinguishes scheduler overrun vs external pressure | P4 | Avoids double-counting scheduler-measured overruns (R5) |
| `LumenPlugin.optional?: boolean` | P14 | Optional-plugin init failure degrades gracefully unless a consumer requires its `provides` keys |

### Runtime delta

| Change | Plan | Note |
|---|---|---|
| Single `MotionPolicy` owner (`runtime/src/motion.ts`) replacing three ad-hoc clamps | P1 | `reveal` cuts interpolation and quantizes scrub seeks; `static` holds t=0 + poster |
| `VersionSkewError` + SSR-skeleton fallback | P8 | On version mismatch with `data-lumen-skeleton` present: static page stays, silent abort, `engine:error`; hard throw only without skeleton |
| Camera evaluation: first `camera` node's world transform drives `RenderFrame.camera` | P5 | Camera-less scenes keep byte-identical `DEFAULT_CAMERA`; snaps under `reveal` |
| a11y hydration: `aria-label`/`aria-description` on island roots + live-region announcer for `scene:next/prev` | P12 | Wire data already existed; idempotent with SSR output |
| Preload pausing while hidden (`PreloadPauser.setPaused`) | P4 | Sheds fetch/buffer work in background tabs |

### Driver / interaction delta

| Change | Plan | Note |
|---|---|---|
| Track segments (reusable fade/hold/out clips) + bezier keyframes | P15 | Templates author patterns once; evaluation unchanged when absent |
| `trackSmoothing` per-track driver interpolation modes | P15 | Data, not a global lerp constant; `MotionPolicy` forces `mode:'none'` |
| Unified scroll input: native `scrollTop` path routed through the same normalize→multiply→clamp→lerp pipeline as `feedDelta` | P9 | Single `setTargetFromNormalized`; `DriverMap` seam untouched |
| Scroll restoration: `{trackId: scalar}` persisted to `history.state` on section boundaries, re-fed on `popstate` | P9 | Throttled ≥500 ms; browser-back restores scene state |
| Continuous↔reduced swap semantics: driver *kind* never changes, only interpolation policy | P1 | Scroll-driven tracks snap to section boundaries under `reveal` |

### Rendering delta

| Change | Plan | Note |
|---|---|---|
| Grouped stacking contexts (`layerGroup` → pooled context `<div>`) | P11 | Video/chapters/hero/logo integer convention becomes typed two-level ordering |
| Full CSS transform mapping via `matrix3d()` (rotate/skew reach CSS) | P11 | Absent rotation → bit-identical CSS output; transform string included in diff key |
| Explicit `rect` payload policy | P11 | Width/height animatable; layout decoupled from viewport-at-adapt-time |
| Decoupled quality ladder: per-axis delta rungs (dpr↓ → msaa↓ → shadows↓ → drop-one-post-pass → …) | P13 | `QualityLevel` shape unchanged; rungs 0–5 match the old ladder exactly |
| Camera wiring: constant camera replaced by evaluated camera node | P5 | No renderer interface change |

### Assets delta

| Change | Plan | Note |
|---|---|---|
| `variants` array crosses the wire with codec/delivery metadata | P2 | `delivery: 'frame-stack'` reserved for P3; `src` remains universal fallback |
| `pickVariant(profile, variants, kind)`: pure capability-aware selection | P7 | Codec filter with never-starve fallback → low-memory clamp → widest within 2× dpr viewport |
| `AssetManager.init` receives the kernel `CapabilityProfile` | P7 | Closes the "one argument wide" plumbing gap; absent profile → legacy static order |

### Codegen / templates delta

| Change | Plan | Note |
|---|---|---|
| Poster SSR fallback: `<img>`/`<video poster>` for canvas-only first-scene nodes | P17 | Crawlable content, P8 fallback surface, P1 `static` poster; removed on `render:first-frame` |
| `data-lumen-skeleton` marker on SSR skeleton | P17+P8 | P8 detects by marker, never class-name sniffing |
| `ssrSkeleton` manifest param; hydration manifest carries `irVersion` | P17/P8 | Ops can diagnose skew from the manifest |
| Per-compose id context (`ComposeContext`) threaded through template helpers | P10 | Reentrant/parallel-build-safe; sequential builds byte-identical |

---

## 3. Deferred — v2.1+ roadmap

**P3 — WebCodecs frame-stack scrub substrate.** A `FrameStackVideo`
implementing the existing `LoadedVideo` interface (`seekTo`/`onFrame`), backed
by `VideoDecoder` plus a ring buffer of pre-decoded `VideoFrame`s around the
playhead for `delivery: 'gop1' | 'frame-stack'` variants (the wire value is
already reserved by P2). This is the real fix for long-GOP scrub stutter; the
120 ms throttle only quantizes it. **Trigger:** device-lab validation of
hardware-decoder behavior — specifically iOS concurrent-decoder limits
(N>2 scrubbed videos silently software-decode) — plus a GOP=1 encode pipeline
milestone so `frame-stack` variants actually have a producer.

**P6 — Named post-pass executor.** A registry (`bloom | grain | vignette |
dof`) with per-renderer executors and a two-target ping-pong chain in the
WebGL backend, keyed to the strings `quality.ts` already emits so P13's
per-pass shedding gains visible effect. Today `RenderFrame.post` names remain
inert. **Trigger:** GPU-dependent visual validation infrastructure (golden-frame
or perceptual-diff harness); pairs naturally with the WebGPU renderer plan,
since shipping pass-graph code on the thin three.js bridge alone duplicates
work.

**P16 — Bandwidth estimation + Save-Data awareness.** A `NetworkMonitor`
(effectiveType/Save-Data probe + rolling throughput EMA from timed
`fetchBytes` completions) feeding preload demotion (`high`→`lazy`) and a
bandwidth class into P7's `pickVariant`. **Trigger:** real-network telemetry
(lab + RUM data) to tune EMA windows and demotion thresholds — shipping
untuned throttling is worse than none.

**CSS scroll-timeline migration path** (noted in Phase 1 §6, still open): for
scroll-driven tracks, the passive-listener → lerp → playhead → applyBindings
chain can be replaced by `animation-timeline: scroll()` on pooled DOM
elements — off-main-thread and INP-free. The seam is exactly `DriverMap`: a
`scroll-timeline` adapter emitting the same `{trackId: scalar}` map from
compositor-driven animations slots into the engine merge point with zero
contract change. P9's unification deliberately preserved that seam.

---

## 4. Architecture health scorecard

| Dimension | v1 | v1.1 | Justification |
|---|---|---|---|
| SceneIR design | B+ | A− | Wire now carries motion semantics, variants, segments, rects; version-skew fails open to skeleton; still no build-time migrator |
| Kernel | B | A− | Visibility policy + longtask attribution + optional plugins landed; event bus still synchronous with no coalescing; no worker offload |
| Drivers | B− | A− | Unified input path, restoration, per-track smoothing, single motion policy; scrub substrate still `currentTime`-based (P3 pending) |
| Rendering | C+ | B+ | Camera live, stacking contexts, full transforms, decoupled ladder; post-passes still inert (P6), WebGPU still a stub |
| Assets | B | A− | Variants cross the wire with capability-aware selection; no bandwidth estimation (P16), no WebCodecs path (P3) |
| a11y | C+ | A− | First-class motion modes, aria hydration, live-region announcer, drift-free policy; needs broader screen-reader field validation |
| Mobile | B+ | B+ | Strong v1 base (dvh, touch, visualViewport, codec probing) plus preload pausing; decoder-budget handling still absent |
| SEO/hydration | B | A− | Poster fallbacks make canvas content crawlable; skew no longer white-screens; hydration manifest carries `irVersion` |
| Tooling | B+ | A− | Reentrant compose, consolidated build/theme/adapter ownership from C1–C9; e2e coverage extended, not restructured |

---

## 5. Compatibility & migration statement

- **SceneIR v1 documents are valid in the v1.1 runtime.** `SCENE_IR_VERSION`
  remains `1`; a hand-built v1 doc with no new fields validates and behaves
  byte-identically (independently re-verified in Phase 5, gate #3).
- **v1.1 documents declare `minRuntime`** (advisory) so ops can diagnose skew;
  v1 runtimes parse v1.1 docs and ignore unknown fields, with bezier keys
  degrading to nearest named easing — never a crash.
- **Behavior defaults are byte-identical** when every new field is absent:
  motion `continuous`, legacy manifest synthesis, flat z-index pool, old
  6-rung quality table semantics, constant camera when no camera node exists.
- **No breaking public API changes**: root `dist/index.js` exposes the same
  208 exports; all 27 do-not-break names and all frozen contract type names
  verified present.
- **Migration for consumers: none required.** Templates and configs authored
  against v1 run unchanged; new capabilities are opt-in per field.

---

## 6. v2 readiness verdict

**Verdict: v1.1 is shipped, validated, and structurally ready for the v2.1
roadmap.** "v2" as originally imagined — a corrective wire-format break — is
no longer necessary: the v1.1 cycle proved the additive-field strategy works
end to end (17 weaknesses, 14 landed, zero breaking changes, 339/339 green).
What "v2" means now is concrete: **the v1.1 additive layer plus the three
deferred items** (P3 frame-stack scrub, P6 post-pass executor, P16 bandwidth
estimation), each gated on evidence rather than design.

**Readiness by persona:**

| Persona | Status |
|---|---|
| Motion designer | **Ready.** Camera tracks, bezier keyframes, segments, per-track smoothing, rotation/stacking on DOM — the v1 expressiveness ceiling (opacity + parallax) is gone. Post-passes are the remaining gap. |
| a11y | **Ready.** First-class motion modes, drift-free single policy, aria hydration, live-region announcements, poster fallbacks. |
| perf | **Mostly ready.** Longtask attribution, visibility shedding, decoupled ladder, capability-aware variants. Awaiting P16 (network adaptation) and P3 (scrub decode cost). |
| product / SEO | **Ready.** Crawlable canvas content, no more white-screen on deploy skew, scroll restoration, import-mapped static dists within budgets. |

**Single most important next investment: P3, the WebCodecs frame-stack scrub
substrate.** Scrubbed video is Lumen's signature interaction and its most
visible defect on real-world encodes; the wire (`delivery: 'gop1' |
'frame-stack'`), the interface seam (`LoadedVideo`), and the selection
plumbing (`pickVariant`) are all already in place. Unblocking it requires
only the device-lab validation, and it converts the largest remaining
architecture-health gap (drivers/scrub) while giving P6's GPU work a natural
second act.
