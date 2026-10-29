# Lumen Engine — Phase 1 Architectural Analysis

*Principal-engineer review of the as-built system. Every claim is grounded in
the code at `contracts/src/*` and `packages/*/src/*`; citations are
`file:line`. This is an analysis, not a rewrite proposal — where something is
done well, it is called out as an invariant to preserve.*

---

## 1. System as-built

**Data flow.** An authored `EngineConfig` is validated/defaulted by
`@lumen/config`; the selected `TemplateDescriptor.compose()` maps config +
`AssetManifest` to a `ComposedScene` (scene-graph forest, timeline tracks,
resolved interaction bindings, hydration hints — `contracts/src/scene.ts:214-228`);
codegen lowers that to a versioned JSON `SceneIR` (`version: 1`,
`contracts/src/ir.ts:18,66-92`) embedded in generated entry modules; at boot
`bootEngine()` (`packages/runtime/src/engine.ts:115`) validates the IR
structurally (`runtime/src/ir.ts:31-90`), raises it back to a `ComposedScene`
(`ir.ts:127-135`), synthesizes a conservative manifest from `IRAssetRef`s
(`ir.ts:142-203`), starts the kernel (created → booting → loading → ready →
active, with preload running as a plugin, `engine.ts:158-172`), selects a
renderer backend, wires interaction + scrub, and starts the frame loop.

**Frame-loop call order** (`engine.ts:224-271`, exact):

1. `interaction.update(dt)` → `DriverMap` (trackId → scalar seconds).
2. Reduced-motion gate: `elapsed` only advances when `!reducedMotion` (`engine.ts:230`).
3. `resolvePlayheads(scene.tracks, elapsed, {})` → defaults; per-track driver
   overrides merged on top (`engine.ts:235-236`).
4. `applyBindings(scene.graph, scene.tracks, playheads)` — dotted-path writes,
   transform writes mark dirty (`scene/src/binding.ts:107-123`).
5. `scrubber.update(playheads, scrubTargets)` → throttled `video.seekTo()`
   (`engine.ts:238`, `runtime/src/scrub.ts:73-105`).
6. `scene.graph.updateWorldTransforms()` (dirty subtrees only).
7. Manual DFS builds a `DrawCall[]` via `drawCallForNode()` and sorts by
   `layer` (`engine.ts:241-253`) — note this bypasses
   `drawCallsFromWorldState()` and does not cull.
8. `renderer.renderFrame(frame, stats)` with a **constant** `DEFAULT_CAMERA`
   (`engine.ts:91-99,257`).
9. `quality.update(stats)` → maybe `renderer.setQuality()` + bus event
   (`engine.ts:264-268`).

**Capability matrix** (`kernel/src/capabilities.ts:156-181`): `webgl2`,
`webgpu` (presence-only probe, `capabilities.ts:65-67`), `offscreenCanvas`,
codecs h264/hevc/av1/vp9 via MediaCapabilities with a conservative static
fallback (`capabilities.ts:101-113`), `maxTextureSize`, `deviceMemoryGB`,
`reducedMotion`, `dpr` envelope `{min:1, max:2, current}` — the max is
hardcoded to 2 (`capabilities.ts:94-99`), silently clipping 3× phones.
Renderer selection is pure over this profile with the frozen chain
webgpu → webgl2 → canvas2d → dom (`rendering/src/select.ts:176,194-219`).

---

## 2. SceneIR v1 analysis

**Strengths — preserve.** Single-owner contract (`contracts/src/ir.ts:1-9`),
frozen wire shape behind `SCENE_IR_VERSION`, and genuinely deep validation:
`describeSceneIRError` checks duplicate node ids, track→node referential
integrity, binding→track referential integrity, and non-empty asset refs
(`runtime/src/ir.ts:45-88`). The hydration manifest (`{ssr, islands}`,
`contracts/src/scene.ts:221-227`) plus `hydrateIslands()`
(`runtime/src/engine.ts:296-307`) is a clean, non-fatal island model.

**Weaknesses.**

- **No reduced-motion semantics.** `SceneIR.a11y` is only
  `{label, summary}` per scene (`contracts/src/ir.ts:91`) and — worse — is
  **never read by the runtime**; it is consumed only by codegen for SSR
  (`codegen/src/common.ts:197`, `gen-static.ts:36-44`). Reduced motion exists
  at runtime solely as the boolean clamp `if (!reducedMotion) elapsed += dt`
  (`engine.ts:230`). Templates compensate ad hoc: cinematic-story smuggles
  `reducedMotion: {transition:'cut'}` through `meta`
  (`templates/src/cinematic-story.ts:139-141`), which is unvalidated and
  template-private. A first-class reduced-motion system needs per-track
  alternative keyframes/easing on the wire — v1 has no slot for them.
- **No hybrid asset representation.** `IRAssetRef` is exactly one `src`
  string (`contracts/src/ir.ts:53-60`); the rich manifest variants
  (avif/webp/srcset, mp4/webm/hls, codec keys — `contracts/src/assets.ts:32,52,106`)
  are collapsed to `variants:{fallback:…}` / `variants:{mp4:{codec:'h264'}}`
  at boot (`runtime/src/ir.ts:153-171`). GOP=1 vs frame-stack delivery,
  per-device-class variant choice, and HEVC-vs-H264 negotiation cannot happen
  at runtime because the information never crosses the wire.
- **No spatial layout primitives beyond transforms.** A node's placement is
  `Transform` (position/quat/scale, `contracts/src/scene.ts:109-116`) plus a
  scalar `layer`. There is no rect/anchor/constraint model; the DOM adapter
  *invents* rects as `surface - world.position`
  (`rendering/src/frame-adapter.ts:44-49`), which makes width/height
  un-animatable and couples layout to viewport size at adapt time.
- **Track model limitations.** Tracks are one value stream per track id with
  sparse keyframes (`contracts/src/scene.ts:197-208`); there are no grouped
  segments/clips, so a "fade in, hold, fade out" is 4 keyframes duplicated
  across every caption track (see scroll-cinema-landing's repeated
  `material.opacity` bindings, `scroll-cinema-landing.ts:235,272,296`).
  Keyframe easing is per-keyframe named easing only
  (`contracts/src/scene.ts:187-194`) — cubic-bezier exists in
  `PropertyBinding.easing` (`scene.ts:128-135`) but **not** on `Keyframe`,
  so bezier-authored motion cannot survive the wire as authored.
- **No driver interpolation modes.** `driver` is a 4-value enum
  (`'time'|'scroll'|'pointer'|'playback'`, `scene.ts:205`) with no
  smoothing/velocity/spring descriptor on the track; smoothing lives only in
  the virtual scroller as a single global lerp (`interaction/src/scroll.ts:43`).
- **IRNode payload flattening.** `raiseNode()` re-materializes payloads from
  flat fields (`runtime/src/ir.ts:93-108`) and silently defaults
  `scrubbed ?? true` — a malformed node becomes *scrubbed*, the more
  expensive behavior. `DomPayload.anchor` (`scene.ts:146-151`) is dropped in
  lowering: `IRNode` has no `anchor` field (`contracts/src/ir.ts:21-38`), so
  hybrid DOM/3D anchoring cannot survive serialization.
- **Versioning story for v2.** Version skew is a hard throw
  (`runtime/src/ir.ts:34-36`) with no migration hook, no `minRuntime` hint,
  and no additive-field tolerance beyond `meta`. Any v2 evolution must ship a
  runtime that speaks both versions or a build-time upgrader.

**Consequence for planned work:** WebGL camera tracks are expressible
(scene.ts:125 includes `'camera'` nodes and binding paths can address
transforms), but the runtime never applies them — `RenderFrame.camera` is
always `DEFAULT_CAMERA` (`engine.ts:257`), so a camera track would evaluate
into the void.

---

## 3. Kernel analysis

**Scheduler** (`kernel/src/scheduler.ts`). Cooperative single rAF loop with
priorities input(0)→timeline(10)→scene(20)→render(30)→post(40)
(`scheduler.ts:26`), per-task timing with hottest-phase attribution
(`scheduler.ts:116-130`), budget reporting plus a degrade hook after 8
consecutive overruns (`scheduler.ts:141-145`). Delta is clamped against
non-monotonic clocks (`scheduler.ts:111`) — good. But:

- **rAF quantization is invisible to the loop.** `FrameInfo.delta` is whatever
  the compositor gives; there is no fixed-timestep accumulator, so physics-ish
  springs in bindings integrate at display rate (90/120 Hz ProMotion runs
  springs ~2× "faster per second of frames" — mitigated only because the
  scroller compensates lerp by `dt*60`, `interaction/src/scroll.ts:90-91`).
- **No longtask/INP awareness.** Budget enforcement measures only the
  scheduler's own tasks (`scheduler.ts:132`); a 200 ms main-thread longtask
  from `innerHTML` writes (`renderer-dom.ts:239`) or image decode is
  unattributed. `PerformanceObserver('longtask')` / `event` timing would slot
  directly into `onBudgetExceeded`.
- **No worker offload despite the groundwork.** Clock/frame-source are
  injectable and OffscreenCanvas is *probed* (`capabilities.ts:69-71,
  select.ts:198-201`) but nothing runs in a worker; the frame loop is
  main-thread only (`engine.ts:224`).
- **Register-time O(n log n) resort per task** (`scheduler.ts:168-174`) —
  fine at boot, but unregister/re-register patterns thrash arrays.

**Lifecycle.** Clean legal-transition table (`kernel/src/lifecycle.ts:14-22`)
with triple event emission — preserve. The gap: **no background-tab
strategy**. There is no `visibilitychange` listener anywhere in the codebase
(grep confirms zero hits in packages/* /src and contracts). rAF stops, but
`elapsed` resumes as if no time passed — actually defensible — yet video
elements keep buffering, the asset preloader keeps fetching, and there is no
'hidden'/'visible' bus event for plugins to shed work.

**Plugin error model.** Topological provides/consumes resolution with cycle
and missing-dependency detection (`kernel/src/plugin.ts:91-142`) and a
correct "init failure aborts boot, dispose never throws" policy
(`plugin.ts:176-219`). Sharp edge: **all** plugin failures are
`recoverable:false` and abort boot (`plugin.ts:185-190`) — there is no
way to declare an optional plugin whose failure degrades gracefully.

**Event bus.** Typed, listener-error-isolated (`event-bus.ts:45-53`) —
preserve. But `emit` is fully synchronous fan-out with **no backpressure or
coalescing**: a wheel storm feeding `asset:progress` or per-frame
`render:quality-change` runs every listener on the emitter's stack. No
`emitDeferred`/microtask batching exists.

---

## 4. Runtime & drivers analysis

**Driver model.** Interaction emits `{trackId: scalar}` (`interaction/src/manager.ts:46`),
the runtime merges it over `resolvePlayheads(tracks, elapsed, {})`
(`engine.ts:235-236`). Note the third argument is `{}` — the scene layer's
own driver-kind path (`scene/src/binding.ts:59-70`) is dead at runtime; all
non-time tracks arrive via the override map. This works, but merge semantics
are **last-write-wins with no conflict detection**: two bindings driving one
track silently interleave per frame in binding-registration order.

**Scrub path** (`runtime/src/scrub.ts`). `collectScrubTargets` walks the graph
for `playback.time` bindings (`scrub.ts:30-46`); the scrubber throttles to
one seek / 120 ms / track with a 1/30 s epsilon (`scrub.ts:74-75,86-87`).
Costs are real and structural:

- **Seek latency**: `LoadedVideo.seekTo` sets `media.currentTime` and waits
  for `seeked`/rVFC with a 5 s timeout (`assets/src/loader.ts:242-281`).
  `HTMLMediaElement` seeking snaps to the nearest keyframe ≤ t and decodes
  forward; with a long GOP (2–10 s typical for H.264 web encodes) a scrub to
  mid-GOP costs tens-to-hundreds of ms — the 120 ms throttle papers over
  this by quantizing scroll to ~8 seeks/s, which is exactly the visible
  "scrub stutter" on non-GOP=1 encodes. The manifest *has* a
  `scrubOptimized` flag (`loader.ts:118`) but nothing verifies the encode;
  `manifestFromAssetRefs` just asserts `scrubOptimized:true` for every IR
  video (`runtime/src/ir.ts:170`).
- **No frame-stack alternative**: there is no WebCodecs `VideoDecoder` path,
  no pre-decoded `VideoFrame` ring buffer — the only scrub substrate is
  `currentTime` assignment.
- Seeks are fire-and-forget (`scrub.ts:91-98`), so fast reversal can apply
  seeks out of order; there is no generation counter on in-flight seeks.

**Dynamic driver swapping is impossible today.** Drivers are baked into
`IRTrack.driver` at compose time; the runtime offers `registerBinding` but
the track's *kind* of playhead source cannot change (e.g. "scroll drives
until section end, then time takes over") without reconstructing the scene.

**Reduced motion** is a boolean clamp at three independent sites
(`engine.ts:230`, `scroll.ts:60-63,76-79`, `manager.ts:62-67`) rather than
one policy object — the three can drift (and do: the scroller snaps to
target, the clock freezes time-tracks, but `video-plane` scrubbed by a
scroll track still seeks frame-accurately under a reduced-motion user).

---

## 5. Rendering analysis

**DOM layer** (`rendering/src/renderer-dom.ts`) — the strongest renderer.
Done well, preserve: element pooling with html/css change-diffing
(`renderer-dom.ts:81-84,238-248`), `willChange` hints, passive viewport
culling (`renderer-dom.ts:126`), overlay sibling to the canvas so DOM and
canvas stack (`renderer-dom.ts:160-171`). Limits:

- **Flat pool + z-index = layer**: all pooled elements live in one flat
  overlay with `zIndex = call.layer` (`renderer-dom.ts:249`); there is no
  nested stacking-context model, so caption/chapter/overlay grouping relies
  on a global integer convention (video 0 / chapters 10 / hero 20 / logo 30,
  per stabilization-report) that no type enforces.
- Transform composition is translate3d + optional `scale(x,y)` only
  (`frame-adapter.ts:28-32,253-254`) — rotation and non-uniform skew never
  reach CSS even though the scene graph carries quaternions.
- `innerHTML` assignment from IR html (`renderer-dom.ts:239`) is a trust
  boundary (documented as deferred P3 in the stabilization report) and a
  main-thread cost the scheduler cannot see.
- SEO/SSR skeleton: codegen emits SSR html for first-scene dom nodes
  (`codegen/src/common.ts:181`, `gen-static.ts:36-44`) — genuinely good;
  canvas-only content has no equivalent (§8).

**Canvas2D / WebGL.** Canvas2D is a disciplined immediate-mode payload switch
(image/sprite/shape/text, `renderer-canvas2d.ts:196-227`). WebGL is a thin
three.js bridge with a pluggable `MeshFactory` and **context-loss handling**
(`renderer-webgl.ts:219,235-236`) — rare and worth preserving. Limits:

- **No shader/effects layer**: `RenderFrame.post` is `{name}[]` strings
  (`contracts/src/rendering.ts:63,71-83`); the WebGL renderer has no pass
  graph, so quality.getLevel()'s postPasses (`quality.ts:126`) are emitted
  but no backend can execute them today.
- **No camera track system**: `camera` nodes produce no draw call
  (`frame-adapter.ts:90`) and the runtime ships a constant camera
  (`engine.ts:257`).
- **Quality ladder granularity**: 6 fixed rungs `{dprScale, msaa,
  shadowMapSize}` (`quality.ts:39-46`) — dpr and MSAA move together; you
  cannot shed MSAA while keeping dpr. Post-pass shedding is all-or-one
  (`quality.ts:126`). The controller itself (EMA + hysteresis + cooldown +
  up-streak, `quality.ts:87-120`) is well-designed — keep it.
- **Frame-adapter boundary**: clean in that payload conventions are owned in
  one file (`frame-adapter.ts:1-9`); leaky in that (a) rect derivation from
  world position (`frame-adapter.ts:44-49`) bakes a layout policy into the
  adapter, (b) opacity is read by reaching into `payload.material.opacity`
  (`frame-adapter.ts:21-25`), coupling the adapter to template material
  conventions, and (c) the runtime duplicates the adapter's sort instead of
  calling `drawCallsFromWorldState` (`engine.ts:241-253` vs
  `frame-adapter.ts:95-104`).

---

## 6. Scroll & mobile analysis

**Virtual scroller math** (`interaction/src/scroll.ts`) is sound:
frame-rate-compensated lerp `alpha = 1-(1-s)^frames` (`scroll.ts:90-92`),
converge-and-snap settle at 1e-4 (`scroll.ts:94-101`), reduced-motion jumps
instantly. Note the scroller can consume *either* `feedDelta` deltas *or*
native `scrollTop` (`scroll.ts:138-153`) — but `attach()` writes `target`
directly from scrollTop, bypassing `wheelMultiplier` and clamping asymmetries;
two input paths with different semantics feeding one state is a latent bug
surface.

**Scroll hijacking.** Continuous listeners are all passive and never
preventDefault (`normalize.ts:213,168-170`) — keyboard handlers do
preventDefault (`manager.ts:122-136`). Because wheel input feeds a *virtual*
playhead while the page may also scroll natively, the two progress sources
can diverge; there is no scroll-restoration or history integration, so
browser-back mid-scene restores scroll but not scene state. The a11y
fallback (`a11yFallback: 'steps'|'static'|'native-video'`,
`contracts/src/interaction.ts:42`) with keyboard step navigation
(`manager.ts:114-136`) is genuinely good — preserve.

**Mobile specifics done right**: `100vh;100dvh` + `touch-action:pan-y` in
critical CSS (`codegen/src/common.ts:174`), `visualViewport` resize listening
for iOS URL-bar (`engine.ts:197-202`), `playsInline` + `muted` on video
elements (`loader.ts:166-167`), HEVC/H264 codec probing
(`capabilities.ts:115-154`). Missing: no explicit decoder-budget handling
(iOS limits concurrent hardware decoders — N>2 scrubbed videos will
silently software-decode or stall, and nothing watches for it), no
`navigator.connection`/Save-Data awareness anywhere.

**CSS scroll-timeline opportunity.** Everything between "passive scroll
listener → lerp → playhead → applyBindings" (`scroll.ts:87-105` →
`engine.ts:235-237`) could, for scroll-driven tracks, be replaced by
`animation-timeline: scroll()` on the pooled DOM elements — off-main-thread,
INP-free. The seam is exactly `DriverMap`; a `scroll-timeline` adapter that
emits the same `{trackId: scalar}` map from compositor-driven animations
slots into `engine.ts:235` with zero contract change. Battery/thermal:
nothing currently pauses time-driven tracks when offscreen or throttles the
loop below display rate on battery saver — the lifecycle/bus hooks to add
this exist; the policy does not.

---

## 7. Asset pipeline analysis

**Loader capabilities.** Per-kind loaders with graceful guards, HLS via
dynamic hls.js import with native-HLS detection (`loader.ts:139-158,180-196`),
scrub-optimized → progressive MP4/WebM preference (`loader.ts:173-184`),
`createImageBitmap` decode path (`loader.ts:321-327`), FontFace, rVFC-based
`onFrame` (`loader.ts:284-307`). Two-tier cache: O(1) LRU + Cache API with
IndexedDB fallback and private-mode rejection recovery
(`cache.ts:156-180`). Priority queue preloading (`preload.ts:47-101`).
All solid.

**Gaps vs needs:**

- **No WebCodecs path.** `VideoDecoder`/`VideoFrame` is never referenced; a
  frame-stack scrub substrate (pre-decoded ring around the playhead) has no
  home. It would slot in as a new `LoadedVideo` implementation behind the
  same `seekTo/onFrame` interface (`contracts/src/assets.ts:118-125`).
- **No frame-stack asset kind** at all — `kind` is
  image/video/model/font/lottie/audio; an image-sequence asset cannot be
  expressed.
- **No adaptive selection by device class.** Variant choice is static:
  `pickImageUrl` prefers avif→webp srcset blindly (`loader.ts:82-96`);
  video picks by scrub flag, not by `CapabilityProfile.codecs` — the kernel
  probes HEVC/AV1 (`capabilities.ts:115-154`) and the loader never consults
  the profile (AssetManager.init receives no capabilities,
  `engine.ts:142-147`). The plumbing mismatch is one argument wide.
- **No bandwidth estimation.** No `navigator.connection.effectiveType`, no
  measured-throughput feedback from `fetchBytes` into preload heuristics;
  `preload: 'critical'|'high'|'lazy'` is the only signal (`preload.ts`).
- **Cache tiering is write-through only on explicit put**; there is no
  revalidation/eviction policy tying T2 quota pressure back to the LRU.

---

## 8. Hydration & SEO stability

- **SSR skeleton** covers first-scene DOM nodes with real HTML + aria labels
  (`gen-static.ts:36-44`, `common.ts:181-197`) and a styled `<noscript>`
  (`gen-static.ts:85-101`) — above industry average for a motion engine.
- **Hydration manifest** is emitted with islands and fails soft:
  `hydrateIslands` skips missing anchors (`engine.ts:296-307`).
- **Version skew**: hard-throw with a clear message (`runtime/src/ir.ts:34-36`)
  — safe, but a stale cached HTML + new runtime deploy (or vice versa) is an
  unrecoverable white screen; there is no "render SSR skeleton statically on
  mismatch" fallback even though the skeleton exists in the DOM already.
  Failing *open* on version mismatch for `dom`-kind content would be nearly
  free.
- **`SceneIR.a11y` dead at runtime** (§2) — hydration does not re-apply
  labels, so islands hydrate without aria wiring.
- **Canvas-only content is uncrawlable**: mesh/sprite/video-plane nodes emit
  no SSR markup at all (`common.ts:181` handles dom nodes only); the
  poster/fallback story exists in the manifest (`poster`,
  `runtime/src/ir.ts:168`) but codegen doesn't emit poster `<img>` fallbacks
  into the skeleton.

---

## 9. Template system analysis

- **compose() purity**: templates call `resetIds()` then bump a module-level
  counter (`templates/src/internal.ts:31-42`, `scroll-cinema-landing.ts:126`)
  — deterministic per call but **not pure and not reentrant**: concurrent
  composes (parallel builds, worker builds) interleave ids. Id generation
  should be per-compose context.
- **internal.ts helper quality**: `normalizeScrollRange` with degenerate-window
  defense (`internal.ts:80-104`), `firstAssetOfKind` deterministic by sorted
  keys — good, boring, correct. Keep.
- **Slot model limits**: composition is one-shot config→scene; slots are
  descriptor-declared config keys, not addressable regions in the scene
  graph — a consumer cannot inject a node into "the hero layer" post-compose
  without editing the template.
- **Transition expressiveness ceiling**: every cross-scene transition in the
  shipped templates is opacity keyframes plus one parallax scale
  (`scroll-cinema-landing.ts:186,235,272,296`; `cinematic-story.ts:131-141`).
  Rotation exists in the transform model but no template uses it because the
  DOM renderer can't consume it (§5); blur/clip-path/filter transitions have
  no binding path at all (`setByPath` can only write existing object paths,
  `binding.ts:27-38`).
- **WebGL-background template today**: possible but hostile. You can emit a
  `mesh` node and a `material` hint (`renderer-webgl.ts:115-131`), but there
  is no camera control (§2), no shader/pass hook (§5), three.js is an
  optional peer that must be dynamically imported
  (`renderer-webgl.ts:180-188`), and the template cannot express "this scene
  requires webgl2" beyond `ModuleRequirement` metadata. A real
  WebGL-background template is a renderer feature request, not a template.

---

## 10. Prioritized weakness register

| ID | Subsystem | Weakness | Impact | Personas | Gates |
|----|-----------|----------|--------|----------|-------|
| W1 | SceneIR/runtime | No reduced-motion semantics on wire; boolean clamp at 3 sites (`engine.ts:230`, `scroll.ts:60`, `manager.ts:62`) | **H** | a11y, motion designer | reduced-motion system |
| W2 | SceneIR/assets | One `src` per `IRAssetRef`; variants collapse at boot (`ir.ts:53-60`, `runtime/src/ir.ts:153-171`) | **H** | end user, perf | hybrid assets |
| W3 | Runtime/scrub | Scrub = `currentTime` seeks only; long-GOP stutter, no WebCodecs/frame-stack (`loader.ts:242-281`, `scrub.ts:74-98`) | **H** | end user, motion designer | hybrid assets, scroll-cinema quality |
| W4 | Kernel | No visibilitychange/background strategy; no longtask/INP attribution (`scheduler.ts:132`) | **H** | perf, end user (battery) | perf evolution |
| W5 | Rendering/runtime | Camera is a constant; camera nodes/tracks evaluate into void (`engine.ts:257`, `frame-adapter.ts:90`) | **H** | motion designer | WebGPU, new templates |
| W6 | Rendering | No shader/post-pass execution; postPasses are inert strings (`rendering.ts:63`, `quality.ts:126`) | M | motion designer | WebGPU, new layers |
| W7 | Assets | No capability-aware variant selection; codec profile unused by loader (`engine.ts:142-147`, `loader.ts:82-96`) | M | perf, end user | hybrid assets |
| W8 | SceneIR | Version skew = hard throw, no migration/fallback (`runtime/src/ir.ts:34-36`) | M | end user, ops | IR v2 |
| W9 | Interaction | Dual scroll input paths (virtual delta vs native scrollTop) with divergent semantics (`scroll.ts:73-80,138-153`); no scroll restoration | M | end user, a11y | CSS scroll-timeline migration |
| W10 | Templates | Module-global id counter; compose not reentrant (`internal.ts:31-42`) | M | tooling, motion designer | parallel builds, new templates |
| W11 | Rendering DOM | Flat z-index pool; no stacking contexts; rotation/skew never reach CSS (`renderer-dom.ts:249`, `frame-adapter.ts:28-32`) | M | motion designer | new layers, transition richness |
| W12 | SceneIR | `a11y` record dead at runtime; hydration skips aria (`contracts/src/ir.ts:91`, `engine.ts:296-307`) | M | a11y | reduced-motion/a11y system |
| W13 | Rendering | Quality ladder couples dpr+MSAA; post shedding all-or-one (`quality.ts:39-46,126`) | L | perf, end user | perf evolution |
| W14 | Kernel | All plugin failures abort boot; no optional-plugin degradation (`plugin.ts:185-190`) | L | extensibility | plugin ecosystem |
| W15 | SceneIR | No track segments/groups; keyframe easing excludes cubic-bezier (`scene.ts:187-194`) | L | motion designer | IR v2, transition richness |
| W16 | Assets | No bandwidth estimation / Save-Data awareness (`preload.ts`) | L | end user, perf | hybrid assets |
| W17 | SEO | Canvas-only nodes have no SSR/poster fallback (`common.ts:181`) | L | SEO, end user | new templates |

**Modern-API → subsystem map:** CSS scroll-timeline → `interaction/scroll.ts`
behind the `DriverMap` seam; WebCodecs `VideoFrame` → new `LoadedVideo`
backend in `assets/loader.ts`; WebGPU → `rendering/select.ts` (chain entry
exists; renderer is a stub per `select.ts:221+`); OffscreenCanvas → kernel
scheduler injectable frame source + `renderer.init` (probe already present);
View Transitions → scene-to-scene navigation bus events
(`scene:next/prev`, `engine.ts:213`); INP/longtasks →
`scheduler.onBudgetExceeded` attribution (`scheduler.ts:34-44`).

---

## Verdict

Lumen is an unusually disciplined v1: the contracts-first rule, the deep IR
validation, the pure capability/selection functions, the DOM renderer's
pool-and-diff discipline, the adaptive-quality hysteresis, and the scrub
throttle all read like code written by people who have operated motion sites
in production — these are invariants to preserve, not accidents to refactor
away. The architecture's center of gravity is exactly right: a serializable
scene document, a driver-agnostic timeline, and a renderer-agnostic draw
list. The structural debts concentrate at three seams: (1) the **wire format
is thinner than the runtime's own manifest** — variants, reduced-motion
alternates, and a11y metadata are computed at build time and then thrown
away before the runtime can use them; (2) **time is privileged over
interaction** — reduced motion is a boolean clamp scattered across three
packages, camera and driver kinds are baked at compose time, and the runtime
merges drivers with last-write-wins; (3) **the GPU half of the engine is a
facade** — constant camera, inert post-pass strings, a stub WebGPU entry —
so every "cinematic" ambition currently routes through opacity keyframes and
`currentTime` seeks that stutter on real-world GOPs. None of these require
rethinking the core; all of them fit the existing seams (DriverMap,
IRenderer, plugin/lifecycle hooks, IR versioning). Health: **good bones,
honest v1; the v2 agenda is additive, not corrective.**
