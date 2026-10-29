# Lumen Engine — Phase 2 Proposed Improvements

*Principal-engineer proposals, mapped 1:1 to the Phase 1 weakness register
(`docs/analysis/phase1-architectural-analysis.md`, §10). Every proposal cites
its file:line evidence, attaches to an **existing seam**, and is **additive
only**: SceneIR v1 wire payloads remain valid, old runtimes and old configs
keep working. Proposals marked **approve-for-patch** are unit-testable in one
pass with no new external dependencies; **plan-only** items need heavy
infrastructure or hardware-dependent validation and should be designed now,
patched later.*

Design stance: senior engineer + motion designer + performance engineer +
accessibility specialist. Invariants named in Phase 1 (contracts-first rule,
deep IR validation, pure selection functions, pool-and-diff DOM renderer,
quality hysteresis, scrub throttle) are preserved untouched.

---

## P1 — First-class reduced-motion semantics on the wire (W1)

**Subsystem:** SceneIR/runtime.
**Evidence:** `SceneIR.a11y` is `{label, summary}` only (`contracts/src/ir.ts:91`);
reduced motion is a boolean clamp at three independent sites
(`packages/runtime/src/engine.ts:230`, `packages/interaction/src/scroll.ts:60-63,76-79`,
`packages/interaction/src/manager.ts:62-67`); cinematic-story smuggles
`reducedMotion:{transition:'cut'}` through unvalidated `meta`
(`packages/templates/src/cinematic-story.ts:139-141`).

- **Seam:** `SceneIR.a11y` record (`contracts/src/ir.ts:91`) + the existing
  clamp sites; `CapabilityProfile.reducedMotion` already probed
  (`kernel/src/capabilities.ts:156-181`).
- **Change:** Add optional `motion?: 'continuous' | 'reveal' | 'static'` per
  `IRTrack` and per scene in `a11y[sceneId]`, plus one runtime
  `MotionPolicy` object owned by the engine and injected into the scroller
  and interaction manager, replacing the three ad-hoc clamps. Semantics:
  `continuous` = today's behavior; `reveal` = opacity/transform *state
  changes* only — crossfades become cuts, scroll-driven tracks step to
  section boundaries (snap, never lerp, including camera tracks per P5), no
  virtual-scroll smoothing, no scroll hijacking (wheel input is not
  consumed beyond native stepping); `static` = time tracks hold at t=0 and
  the poster fallback (P17) is shown. Driver *kind* never changes under
  reduced motion; only interpolation policy does. The clamp at
  `engine.ts:230` becomes `policy.advanceTime(dt)`; the scroller clamps at
  `scroll.ts:60-63,76-79` become `policy.interpolate()`; scrubbed video
  under `reveal` quantizes seeks to section boundaries instead of seeking
  frame-accurately (closing the drift Phase 1 §4 identified).
- **Compatibility:** All new fields optional; absent = `continuous`, byte-
  identical behavior to today. `meta`-smuggled template hints keep working;
  templates can migrate later.
- **Effort:** M. **Phase-3:** **approve-for-patch.**

## P2 — Variant array on `IRAssetRef` (W2)

**Subsystem:** SceneIR/assets.
**Evidence:** `IRAssetRef` is exactly one `src` string
(`contracts/src/ir.ts:53-60`); manifest variants (avif/webp/srcset,
mp4/webm/hls, codec keys — `contracts/src/assets.ts:32,52,106`) are
collapsed at boot to `variants:{fallback:…}` / `variants:{mp4:{codec:'h264'}}`
(`packages/runtime/src/ir.ts:153-171`).

- **Seam:** `IRAssetRef` (contracts) + `manifestFromAssetRefs()`
  (`runtime/src/ir.ts:142-203`).
- **Change:** Add optional
  `variants?: Array<{ src: string; format?: string; codec?: string; width?: number; delivery: 'progressive' | 'gop1' | 'frame-stack' | 'hls'; bytes?: number }>`
  to `IRAssetRef`, populated by codegen from the rich manifest it already
  computes and currently throws away. `manifestFromAssetRefs` becomes a
  pass-through when `variants` is present, falling back to today's
  conservative synthesis when absent. `src` stays populated as the
  universal fallback, so the field is purely additive. (The device-class
  *selection* among variants is P7; the WebCodecs/frame-stack *consumption*
  is P3.)
- **Compatibility:** v1 readers ignore unknown fields (validation in
  `runtime/src/ir.ts:45-88` checks only structural invariants); old IR
  without `variants` takes the existing synthesis path unchanged.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P3 — Frame-stack scrub substrate via WebCodecs (W3)

**Subsystem:** Runtime/scrub.
**Evidence:** Scrub is `currentTime` seeks only
(`packages/assets/src/loader.ts:242-281`, `packages/runtime/src/scrub.ts:74-98`);
`manifestFromAssetRefs` asserts `scrubOptimized:true` for every IR video
unverified (`runtime/src/ir.ts:170`); no `VideoDecoder`/`VideoFrame`
reference anywhere; seeks are fire-and-forget with no generation counter
(`scrub.ts:91-98`).

- **Seam:** `LoadedVideo` interface (`seekTo`/`onFrame`,
  `contracts/src/assets.ts:118-125`) — a new implementation slots behind it
  unchanged; `delivery:'gop1' | 'frame-stack'` variants arrive via P2.
- **Change:** (a) Short-term, patchable: add a seek generation counter in
  the scrubber so stale `seeked` resolutions are dropped, and stop
  asserting `scrubOptimized` blindly. (b) Plan: a
  `FrameStackVideo implements LoadedVideo` — a `VideoDecoder` + ring buffer
  of pre-decoded `VideoFrame`s around the playhead for `delivery:'gop1'`
  assets, with an animated-WebP/AVIF frame-stack variant for short loops.
- **Compatibility:** Interface-stable; `HTMLMediaElement` backend remains
  the default and only path when WebCodecs is absent (probed via the
  existing codec matrix, `capabilities.ts:115-154`).
- **Effort:** L. **Phase-3:** **plan-only** (hardware-decoder behavior —
  iOS concurrent-decoder limits per Phase 1 §6 — needs device lab
  validation). The generation-counter sub-fix may ride with P-adjacent
  patches if desired.

## P4 — Kernel visibility policy + longtask attribution (W4)

**Subsystem:** Kernel.
**Evidence:** Zero `visibilitychange` listeners in the codebase (Phase 1 §3
grep); budget enforcement measures only the scheduler's own tasks
(`kernel/src/scheduler.ts:132`), so `innerHTML` longtasks
(`rendering/src/renderer-dom.ts:239`) are unattributed; no `hidden`/`visible`
bus event exists.

- **Seam:** Lifecycle transition table + event bus
  (`kernel/src/lifecycle.ts:14-22`); `onBudgetExceeded` hook
  (`scheduler.ts:34-44,141-145`).
- **Change:** Add a kernel-owned `visibilitychange` listener that emits
  `engine:visibility` (`'hidden' | 'visible'`) on the bus and pauses the
  preloader's priority queue and video buffering while hidden (elapsed
  semantics unchanged — resuming without time jump is defensible per Phase
  1). Add a `PerformanceObserver('longtask')` feed that attributes >50 ms
  tasks to `onBudgetExceeded` as external pressure so the degrade hook
  (`scheduler.ts:141-145`) reacts to real jank, not just scheduler
  overruns. Both are listeners/observers on existing hooks — no scheduler
  or lifecycle state changes.
- **Compatibility:** New bus event only; plugins that don't subscribe are
  unaffected. `PerformanceObserver` guarded by feature detection.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P5 — Camera tracks actually drive the camera (W5)

**Subsystem:** Rendering/runtime.
**Evidence:** `RenderFrame.camera` is always the constant `DEFAULT_CAMERA`
(`packages/runtime/src/engine.ts:91-99,257`); `camera` nodes produce no
draw call (`rendering/src/frame-adapter.ts:90`), so camera tracks evaluate
into the void (Phase 1 §2 consequence).

- **Seam:** `RenderFrame.camera` field (`contracts/src/rendering.ts`) +
  binding paths that already address transforms
  (`contracts/src/scene.ts:125`); the frame loop step 8 call site
  (`engine.ts:257`).
- **Change:** After `applyBindings` (step 4, `engine.ts:235-237`), resolve
  the active scene's first `camera` node's world transform into a
  `CameraState` and pass it instead of `DEFAULT_CAMERA`; keep
  `DEFAULT_CAMERA` when no camera node exists. Under P1's `reveal`/`static`
  policy, camera moves snap between section keyframes (no lerp). No
  renderer interface change — both WebGL and future WebGPU backends already
  receive `frame.camera`.
- **Compatibility:** Scenes without camera nodes get byte-identical frames.
  Pure runtime evaluation; no IR change.
- **Effort:** M. **Phase-3:** **approve-for-patch** (unit-testable on
  `resolvePlayheads` + world-transform fixtures; three.js not required —
  canvas2d/dom tests can assert the camera value passes through).

## P6 — Minimal post-pass executor (W6)

**Subsystem:** Rendering.
**Evidence:** `RenderFrame.post` is `{name}[]` strings
(`contracts/src/rendering.ts:63,71-83`); `quality.getLevel().postPasses`
are emitted but no backend can execute them (`engine.ts:264-268`,
`rendering/src/quality.ts:126`); WebGL has no pass graph
(`rendering/src/renderer-webgl.ts`).

- **Seam:** The existing `post: {name}[]` wire and the WebGL renderer's
  `MeshFactory` plugin point (`renderer-webgl.ts:115-131`).
- **Change:** Define a named-pass registry (`'bloom' | 'grain' | 'vignette'
  | 'dof'`) with per-renderer executors; WebGL gets a small two-target
  ping-pong chain executed in `renderFrame` after scene draw. Registry keys
  match the strings `quality.ts:126` already emits, so quality shedding
  (P13) gains real effect. Unknown names remain inert no-ops, as today.
- **Compatibility:** No contract change; renderers without executors keep
  ignoring `post`.
- **Effort:** L (shader authoring + render-target management).
  **Phase-3:** **plan-only** (visual validation is GPU-dependent; pairs
  naturally with the WebGPU renderer plan).

## P7 — Capability-aware variant selection (W7)

**Subsystem:** Assets.
**Evidence:** `pickImageUrl` prefers avif→webp blindly
(`packages/assets/src/loader.ts:82-96`); video picks by scrub flag, not by
`CapabilityProfile.codecs`; `AssetManager.init` receives no capabilities
(`packages/runtime/src/engine.ts:142-147`) — "the plumbing mismatch is one
argument wide."

- **Seam:** `assets.init()` options object at `engine.ts:142-147`; the
  already-pure selection seam used by `rendering/src/select.ts`.
- **Change:** Pass the kernel's `CapabilityProfile` into `assets.init` as
  an optional `capabilities` field; add a pure
  `pickVariant(profile, variants)` (codec support → device memory class →
  dpr) used by image and video loaders when P2's variant array is present.
  Selection stays deterministic and unit-testable like `select.ts:176,194-219`.
- **Compatibility:** Options field optional; absent profile → today's
  static preference order. No IR change.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P8 — Version-skew fallback to SSR skeleton (W8)

**Subsystem:** SceneIR/runtime.
**Evidence:** Version mismatch is a hard throw
(`packages/runtime/src/ir.ts:34-36`); stale cached HTML + new runtime
deploy = unrecoverable white screen even though the SSR skeleton is already
in the DOM (`codegen/src/gen-static.ts:36-44`, Phase 1 §8).

- **Seam:** The existing throw site (`ir.ts:34-36`) and the already-emitted
  SSR skeleton + `<noscript>` styling.
- **Change:** On `version` mismatch, before throwing, detect a DOM-kind
  SSR skeleton (data attribute emitted by codegen); if present, leave it
  visible, emit `engine:error` with code `ir-version-skew` on the bus, and
  abort boot *silently for the user* — the static, aria-labeled page
  remains readable and crawlable. Only when no skeleton exists do we keep
  the hard throw. Optionally accept an IR-declared `minRuntime` hint in the
  error payload to speed ops diagnosis (advisory field, not required).
- **Compatibility:** Failure-mode-only change; success paths untouched.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P9 — Unified scroll input path (W9)

**Subsystem:** Interaction.
**Evidence:** The scroller consumes either `feedDelta` deltas or native
`scrollTop`, and `attach()` writes `target` directly from scrollTop,
bypassing `wheelMultiplier` and clamping asymmetries
(`packages/interaction/src/scroll.ts:73-80,138-153`) — two input paths with
different semantics feeding one state; no scroll restoration (Phase 1 §6).

- **Seam:** Inside `VirtualScroller` only — the `DriverMap` output
  (`interaction/src/manager.ts:46`) and the `engine.ts:235` merge are
  untouched, which is also exactly the seam a future CSS `scroll()`
  adapter targets.
- **Change:** Route the `attach()` native-scroll path through the same
  normalize → multiply → clamp → lerp pipeline as `feedDelta`
  (single entry `setTargetFromNormalized(value)`), making the two sources
  semantically identical. Add scroll-restoration: persist
  `{trackId: scalar}` progress to `history.state` on section boundaries
  and re-feed it on `popstate`, so browser-back mid-scene restores scene
  state. Under P1 reduced motion, both paths converge on section snaps with
  no smoothing.
- **Compatibility:** Internal behavior fix; public API and DriverMap shape
  unchanged.
- **Effort:** M. **Phase-3:** **approve-for-patch.**

## P10 — Per-compose id context (W10)

**Subsystem:** Templates.
**Evidence:** `compose()` calls `resetIds()` then bumps a module-level
counter (`packages/templates/src/internal.ts:31-42`,
`scroll-cinema-landing.ts:126`) — deterministic per call but not reentrant;
parallel/worker builds interleave ids.

- **Seam:** `internal.ts` id helpers; `TemplateDescriptor.compose()`
  signature already receives a full config context
  (`contracts/src/scene.ts:214-228`).
- **Change:** Introduce a `ComposeContext` (id counter + seed) created per
  `compose()` invocation and threaded through the internal helpers; keep
  the module-level functions as thin wrappers over a default context so
  existing template code compiles unchanged. Deterministic ids preserved
  (counter semantics identical within a compose).
- **Compatibility:** Additive API; templates migrate opportunistically.
  Generated IR is byte-identical for sequential builds.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P11 — DOM layer richness: stacking contexts + full transform mapping (W11)

**Subsystem:** Rendering DOM.
**Evidence:** All pooled elements sit in one flat overlay with
`zIndex = call.layer` (`packages/rendering/src/renderer-dom.ts:249`);
transform composition is translate3d + optional `scale(x,y)` only
(`rendering/src/frame-adapter.ts:28-32,253-254`) — rotation/skew never
reach CSS though the graph carries quaternions; layout is invented as
`surface - world.position` (`frame-adapter.ts:44-49`).

- **Seam:** `frame-adapter.ts` payload-convention ownership
  (`frame-adapter.ts:1-9`) and the DOM pool diff path
  (`renderer-dom.ts:81-84,238-248`).
- **Change:** (a) Add optional grouped layers: a `layerGroup` hint on DOM
  payloads creates a pooled stacking-context `<div>` per group, so the
  video/chapters/hero/logo integer convention (Phase 1 §5) becomes a typed
  two-level ordering instead of a global z-index free-for-all. (b) Extend
  the CSS transform mapping to `matrix3d()` (or rotateZ + skew for the 2D
  common case) when the world transform carries rotation, unlocking
  template transitions beyond opacity+parallax. (c) Rect policy fix:
  introduce an explicit optional `rect` on DOM payloads (set by templates
  at compose time); the adapter prefers it and only falls back to
  `surface - world.position` when absent — making width/height animatable
  and decoupling layout from viewport-at-adapt-time.
- **Compatibility:** All payload fields optional; absent → current CSS
  output bit-for-bit.
- **Effort:** M. **Phase-3:** **approve-for-patch.**

## P12 — a11y hydration: wire `SceneIR.a11y` into the runtime (W12)

**Subsystem:** SceneIR/runtime hydration.
**Evidence:** `SceneIR.a11y` (`contracts/src/ir.ts:91`) is consumed only by
codegen for SSR (`codegen/src/common.ts:197`, `gen-static.ts:36-44`) and
never read by the runtime; `hydrateIslands` skips aria wiring
(`packages/runtime/src/engine.ts:296-307`, Phase 1 §8).

- **Seam:** `hydrateIslands()` (`engine.ts:296-307`) + the scene-id-keyed
  `a11y` record already on the wire.
- **Change:** During island hydration, apply `a11y[sceneId].label` as
  `aria-label` (and `summary` as `aria-description`/visually-hidden
  description node) to the island root, matching what codegen emitted for
  SSR; register a single live-region announcer on the bus for
  `scene:next/prev` (`engine.ts:213`) so scene changes are announced with
  the scene label. Pair with P1 so `motion:'reveal'/'static'` scenes get
  their snap transitions announced as discrete state changes rather than
  silent crossfades.
- **Compatibility:** Reads existing wire data; absent entries = today's
  behavior. SSR output unchanged (idempotent re-application).
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P13 — Decoupled quality ladder rungs (W13)

**Subsystem:** Rendering quality.
**Evidence:** 6 fixed rungs `{dprScale, msaa, shadowMapSize}` move dpr and
MSAA together (`packages/rendering/src/quality.ts:39-46`); post shedding is
all-or-one (`quality.ts:126`). The EMA + hysteresis + cooldown controller
(`quality.ts:87-120`) is well-designed — keep it.

- **Seam:** The rung table only; controller, `setQuality()` bus event, and
  `IRenderer.setQuality` signature untouched.
- **Change:** Redefine the ladder as an ordered list of *deltas* the
  controller applies one axis at a time (dpr↓ → msaa↓ → shadows↓ →
  drop-one-post-pass → dpr↓…), expressed as an extended rung table with
  per-axis fields. Interpolate the new table onto the existing
  `QualityLevel` shape so renderers see the same object; the controller's
  rung index simply traverses a longer ladder. Post-pass shedding drops
  passes right-to-left through P6's registry instead of all-or-one.
- **Compatibility:** `QualityLevel` shape unchanged; renderers and bus
  consumers unaffected. Old 6-rung behavior recoverable as a table preset.
- **Effort:** M. **Phase-3:** **approve-for-patch** (pure data + controller
  logic; device-tuning of the table can iterate later).

## P14 — Optional-plugin degradation (W14)

**Subsystem:** Kernel plugins.
**Evidence:** **All** plugin failures are `recoverable:false` and abort
boot (`packages/kernel/src/plugin.ts:185-190`); there is no way to declare
an optional plugin whose failure degrades gracefully.

- **Seam:** Plugin descriptor + the init-failure branch
  (`plugin.ts:176-219`); topological provides/consumes resolution
  (`plugin.ts:91-142`) untouched.
- **Change:** Add `optional?: boolean` to the plugin descriptor. On init
  failure of an optional plugin: emit `engine:error` (recoverable), mark
  its `provides` keys unsatisfied, and fail fast *only* if another plugin
  `consumes` those keys — otherwise continue boot without it. Dispose
  semantics unchanged ("dispose never throws"). This gives the preload,
  analytics, or future decoder plugins a graceful-degradation story without
  weakening mandatory-plugin guarantees.
- **Compatibility:** Descriptor field optional; existing plugins are
  mandatory by default — identical failure semantics.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

## P15 — Track segments, keyframe bezier, and driver smoothing descriptor (W15)

**Subsystem:** SceneIR tracks.
**Evidence:** No grouped segments/clips — "fade in, hold, fade out" is 4
keyframes duplicated per caption track
(`contracts/src/scene.ts:197-208`, `scroll-cinema-landing.ts:235,272,296`);
cubic-bezier exists on `PropertyBinding.easing` (`scene.ts:128-135`) but
**not** on `Keyframe` (`scene.ts:187-194`), so bezier-authored motion can't
survive the wire; smoothing lives only as one global lerp
(`interaction/src/scroll.ts:43`).

- **Seam:** `IRTrack`/`Keyframe` (contracts) + `resolvePlayheads`
  evaluation (`scene/src/binding.ts:59-70`).
- **Change:** Three additive fields: (a) `segments?: Array<{from, to, keys}>` —
  named, reusable clips a track can reference, letting templates author
  fade-in/hold/fade-out once per *pattern* instead of per caption; (b)
  `easing?: {bezier: [number,number,number,number]}` as an alternative to
  the named-easing string on `Keyframe`; (c) `smoothing?: {mode: 'lerp' |
  'spring' | 'none', stiffness?: number, damping?: number}` on `IRTrack`,
  consumed by the driver layer so per-track driver interpolation modes
  (snap vs lerp vs spring) are data, not a global constant — and P1's
  reduced-motion policy simply forces `mode:'none'`. Evaluation changes
  only when the fields are present.
- **Compatibility:** All optional; v1 IR without them evaluates
  identically. Bezier keys lower to existing named easings as fallback in
  old runtimes via codegen (old runtime + new IR degrades to nearest named
  easing, never crashes, per validation scope at `runtime/src/ir.ts:45-88`).
- **Effort:** M. **Phase-3:** **approve-for-patch.**

## P16 — Bandwidth estimation + Save-Data awareness (W16)

**Subsystem:** Assets/preload.
**Evidence:** No `navigator.connection.effectiveType`, no
measured-throughput feedback from `fetchBytes` into preload heuristics, no
Save-Data awareness anywhere; `preload: 'critical'|'high'|'lazy'` is the
only signal (`packages/assets/src/preload.ts`, Phase 1 §6/§7).

- **Seam:** Preloader priority queue (`preload.ts:47-101`) and
  `fetchBytes`; capability profile is the natural home for a
  `network` facet next to `deviceMemoryGB` (`capabilities.ts:156-181`).
- **Change:** Add a `NetworkMonitor` (effectiveType + Save-Data probe,
  rolling throughput EMA from timed `fetchBytes` completions) feeding two
  policy outputs: demote `high`→`lazy` on constrained links, and feed a
  bandwidth class into P7's `pickVariant` so variant choice considers the
  pipe, not just the device. Requires real-network telemetry to tune EMA
  windows and demotion thresholds safely.
- **Compatibility:** Optional profile facet; absent → current static
  priorities.
- **Effort:** M (code) + field validation. **Phase-3:** **plan-only**
  (threshold tuning needs lab + RUM data; shipping untuned throttling is
  worse than none).

## P17 — Poster/SSR fallback for canvas-only nodes (W17)

**Subsystem:** Codegen/SEO.
**Evidence:** `codegen/src/common.ts:181` emits SSR html for dom nodes
only; mesh/sprite/video-plane nodes emit no markup, though `poster` already
exists in the synthesized manifest (`packages/runtime/src/ir.ts:168`).

- **Seam:** The existing SSR skeleton emitter
  (`codegen/src/common.ts:181-197`, `gen-static.ts:36-44`) + manifest
  `poster` fields + P2's variant metadata.
- **Change:** For each first-scene canvas-only node with a poster (or a
  derivable `frame-stack`/`gop1` first frame per P2), emit a
  `<img src=poster alt=scene-label>` (or `<video poster muted playsinline>`)
  into the SSR skeleton, positioned in the same layer order as the runtime
  overlay. It doubles as: crawlable content, the P8 version-skew fallback
  surface, and P1's `static` reduced-motion poster. Hydration removes the
  fallback image once the canvas layer reports its first frame (bus event).
- **Compatibility:** Emission-only change in codegen; runtime gains one
  optional removal step. Pages without posters unchanged.
- **Effort:** S. **Phase-3:** **approve-for-patch.**

---

## Approval summary

| P# | W# | Title | Effort | Approved-for-patch |
|----|----|-------|--------|--------------------|
| P1 | W1 | Reduced-motion IR semantics + runtime MotionPolicy | M | **yes** |
| P2 | W2 | Variant array on IRAssetRef | S | **yes** |
| P3 | W3 | WebCodecs frame-stack scrub substrate | L | no (plan-only) |
| P4 | W4 | visibilitychange policy + longtask attribution | S | **yes** |
| P5 | W5 | Camera tracks drive RenderFrame.camera | M | **yes** |
| P6 | W6 | Named post-pass executor (WebGL) | L | no (plan-only) |
| P7 | W7 | Capability-aware variant selection | S | **yes** |
| P8 | W8 | Version-skew SSR-skeleton fallback | S | **yes** |
| P9 | W9 | Unified scroll input + restoration | M | **yes** |
| P10 | W10 | Per-compose id context | S | **yes** |
| P11 | W11 | DOM stacking contexts + full CSS transforms + rect policy | M | **yes** |
| P12 | W12 | a11y hydration + live-region announcer | S | **yes** |
| P13 | W13 | Decoupled quality ladder axes | M | **yes** |
| P14 | W14 | Optional-plugin degradation | S | **yes** |
| P15 | W15 | Track segments, keyframe bezier, driver smoothing | M | **yes** |
| P16 | W16 | Bandwidth estimation / Save-Data | M | no (plan-only) |
| P17 | W17 | Poster/SSR fallback for canvas-only nodes | S | **yes** |

**14 approved-for-patch, 3 plan-only (P3, P6, P16).** Dependency notes for
Phase 3 sequencing: P2 before P7 and P16; P1 before P5's snap behavior and
P17's static mode; P6 before P13's per-pass shedding has visible effect;
P8 and P17 jointly close the white-screen/crawlability hole. Everything
approved is additive against SceneIR v1 and carries no new external
dependency.
