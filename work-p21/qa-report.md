# Lumen Engine — QA & Stabilization Audit

Scope: read-only audit of `packages/{kernel,runtime,rendering,assets,interaction,scene,templates,codegen,config,build}` sources and `examples/*/dist` output. Severity: **P0** crash/data-loss, **P1** broken in a common scenario, **P2** degraded, **P3** polish. All line refs are to `src/*.ts`.

---

## 1. Runtime risks

### P1 — Generated sites never surface boot failures (unhandled rejection + silent errors)
- `packages/codegen/src/gen-static.ts:121-129` emits `void main();` — any `bootEngine()` rejection (bad IR, renderer failure, fetch failure in `gen-runtime.ts:51` `void loadLumen(autoUrl)`) becomes an unhandled promise rejection and a permanently blank page. No `.catch`, no DOM error fallback, and generated code never subscribes to `engine:error`.
- Fix: emit `void main().catch(err => { console.error(err); root.innerHTML = '<p role="alert">…</p>'; })` and subscribe `engine.on('engine:error', …)` with a visible/console fallback.

### P1 — Plugin init failures are swallowed; boot reports success anyway
- `packages/kernel/src/plugin.ts:114-131` wraps every plugin `init()` in `guardAsync` with `recoverable: false`, but `guardAsync` (`errors.ts:77-87`) **catches and returns undefined** — the error is only emitted as an `engine:error` event. `kernel.start()` (`kernel.ts:97-118`) then proceeds to `ready`/`active`. A failed asset-preload plugin therefore yields an "active" engine with no assets; combined with the finding above, nobody listens, so this is fully silent.
- Fix: in `initAll`, rethrow when `recoverable === false` (or collect failures and let `start()` decide); keep containment only for recoverable failures.

### P1 — Boot failure mid-sequence leaks kernel/plugins/scheduler
- `packages/runtime/src/engine.ts:162-174`: if `kernel.start()` succeeds but `createRenderer()` (or anything after) throws, `bootEngine` rejects without `kernel.dispose()` — plugins, asset handles, and the (already started) scheduler keep running. Note the scheduler is started inside `kernel.start()` (`kernel.ts:108`) *before* the renderer exists.
- Fix: wrap everything after `createKernel` in try/catch; on failure `await kernel.dispose()` and remove the appended canvas before rethrowing.

### P2 — `AssetManager.dispose()` wipes the origin-wide persistent cache
- `packages/assets/src/manager.ts:178` → `cache.clear()` → `PersistentCache.clear()` (`cache.ts:210-221`) does `caches.delete('lumen-assets-v1')` / full IDB store clear. Disposing one engine instance destroys the shared persistent asset cache for every other page/visit — defeats the tier-2 cache design and destroys data the user agent was asked to keep.
- Fix: on dispose, clear only in-memory state and video/font handles; leave the persistent tier (or delete only keys owned by this manifest).

### P2 — `ImageBitmap`s never closed; texture/blob resources leak on dispose
- `manager.ts:167-180` disposes videos and fonts but never calls `bitmap.close()` on image handles (`loader.ts:289-295` creates them). `WebGLRenderer.dispose()` disposes textures but not geometries/materials created by `defaultMeshFactory` (`renderer-webgl.ts:321-331` disposes neither `BoxGeometry` nor materials in `this.objects`). GPU memory grows across boot/dispose cycles.
- Fix: close bitmaps in `AssetManager.dispose()`; in WebGLRenderer track geometries/materials per object and dispose them.

### P2 — Video `seekTo` can hang forever and can throw on NaN duration
- `loader.ts:233-249`: promise resolves only on rVFC or `seeked`; no error/timeout path — a stalled element hangs the awaiter forever. `LoadedVideo.duration` comes from the manifest (`entry.duration`) which is **not validated** (see §4) — `NaN`/`undefined` duration makes `Math.min(Math.max(time,0), NaN)` → `NaN`, and assigning `media.currentTime = NaN` throws `TypeError`.
- Fix: clamp with a finite fallback (`Number.isFinite(d) && d > 0 ? d : 0`), add an `error` listener + timeout rejecting the seek promise.

### P3 — Scheduler edge cases
- `scheduler.ts:149-153`: if a task calls `stop()` mid-frame (e.g. `pause()` from a task), the loop still schedules one more rAF after `runFrame` (`handle = requestFrame(loop)` is unconditional). One leaked callback; harmless but sloppy. Fix: re-check `running` before re-scheduling.
- `scheduler.ts:109`: `delta` can be negative with non-monotonic injected clocks; no clamp. `tick()` runs tasks even when stopped (documented, OK).
- Double-`bootEngine()` on the same root is unguarded: two canvases are appended (`engine.ts:167-171`) and both loops run. Fix: stamp `rootElement.dataset.lumenBooted` and refuse/reuse.

### SOLID (runtime/kernel)
- Error boundaries genuinely catch: scheduler `onTaskError` (`scheduler.ts:118-122`), event-bus listener isolation incl. the error hook itself (`event-bus.ts:45-53, 107-125`), plugin dispose never throws (`plugin.ts:132-145`).
- rAF lifecycle: `stop()` cancels the pending handle (`scheduler.ts:179-183`); `pause/resume/dispose` all route through `scheduler.stop()`; `start()` is idempotent (`kernel.ts:98`, `scheduler.ts:173-177`); dispose from any pre-active phase is legal (`lifecycle.ts:14-22`).
- Plugin dependency DAG has cycle + missing-dependency detection (`plugin.ts:29-80`).
- Timeline math is defensive: zero-length ranges clamp (`timeline.ts:92`), empty keyframes → `undefined` (`:119`), zero keyframe span → `raw = 0` (`:147`), zero quaternion normalized to identity (`math.ts:69`), division-by-zero in normalize/velocity helpers guarded (`normalize.ts:42-58`).

---

## 2. Browser compatibility

### P1 — Emitted static site cannot run unbundled: bare specifier, no import map
- All `examples/*/dist/main.*.js` begin with `import { bootEngine, hydrateIslands } from '@lumen/runtime';` and the emitted `index.html` (`gen-static.ts:51-106`) contains **no `<script type="importmap">`** and no bundling step. `packages/build` only rewrites relative hashed specifiers (`pipeline.ts:106-122`, `hash.ts`). Opened directly in a browser, every example throws `TypeError: Failed to resolve module specifier "@lumen/runtime"` — the shipped artifacts are non-functional as-is.
- Fix (choose one): emit an import map pointing at a bundled runtime chunk; add a real bundling pass in `@lumen/build` for target `static`; or document + enforce that `static` output requires a downstream bundler (and add a smoke check in `tests/e2e`).

### P2 — WebGL context-loss handling absent
- `renderer-webgl.ts` never listens for `webglcontextlost`/`webglcontextrestored`. On mobile GPU pressure the canvas goes black permanently. Fix: register listeners in `init()`, prevent default on lost, rebuild GL state on restore (or recreate renderer via `createRenderer` fallback chain).

### P3 — Guarded APIs (verified OK)
- `requestVideoFrameCallback` properly feature-detected with `seeked` fallback (`loader.ts:243-248, 258-260`); `OffscreenCanvas` guarded (`capabilities.ts:71-73`, `renderer-canvas2d.ts:76-89`); `createImageBitmap` guarded (`loader.ts:290`); `FontFace`/`document.fonts` guarded (`loader.ts:310`); Cache API + IndexedDB guarded and best-effort (`cache.ts:167-170, 183-220`); `MediaCapabilities` guarded with fallback table (`capabilities.ts:136-137`); dynamic `import('three')` / `import('hls.js')` wrapped in try/catch with typed fallback (`renderer-webgl.ts:181-190`, `loader.ts:139-154`). WebGL2 probe + context-creation failure both throw recoverable `RenderingError`s that walk the fallback chain (`select.ts:77-92`).
- `deviceorientation` listener is attached unconditionally (`normalize.ts:223`) with no iOS 13+ `DeviceOrientationEvent.requestPermission()` flow — the binding silently never fires on iOS. P3 fix: only attach after permission grant when `requestPermission` exists.
- Emitted JS language level is ~ES2020+ (native ESM, `??`, optional chaining) — fine for all modern browsers; not transpiled, so no legacy support (note only).

---

## 3. Mobile responsiveness

### P1 — Scroll-scrub is broken on touch devices
- `InputNormalizer.attach` (`normalize.ts:179-208`) listens to `wheel` (desktop-only) and `pointer*`; there is **no `touchmove`/touch-scroll path feeding the virtual scroller** — `scroller.feedDelta` is only called for `source === 'scroll'` wheel events (`manager.ts:74-78`). On phones, scroll-driven tracks (every scroll-video template) never advance unless `scroller.attach(el)` native-scroll path is used, and generated sites never call it. Additionally the wheel listener is `{ passive: true }` (`normalize.ts:170`) and nothing sets `touch-action` CSS, so even desktop wheel scrolls the page *and* the virtual scroller (double-scroll conflict) — there is no scroll-hijack story at all.
- Fix: decide the model — either (a) map `pan` gestures onto the scroller for touch, or (b) have codegen emit a tall scroll container and wire `scroller.attach(document.scrollingElement)`; set `touch-action: pan-y` (or `none` where hijacking) in `criticalCss`.

### P2 — iOS 100vh / viewport issues
- `criticalCss` (`codegen/src/common.ts:140-149`) emits `.lumen-root{min-height:100vh}` — the classic iOS Safari URL-bar bug; no `svh`/`dvh` fallback, no `visualViewport` usage, and the viewport meta (`gen-static.ts:60`) lacks `viewport-fit=cover` (notch insets ignored, no `env(safe-area-inset-*)`). Renderer resize listens only to `window.resize` (`engine.ts:187`), which does not reliably fire on iOS orientation/URL-bar collapse — `visualViewport.resize` is the robust signal.
- Fix: `min-height:100vh; min-height:100dvh;`, add `viewport-fit=cover`, subscribe to `visualViewport?.resize` too.

### P2 — Video autoplay policy mostly OK, but posters/videos never rendered (see §5)
- `muted` + `playsInline` + `preload` are set on loaded videos (`loader.ts:165-167`) — correct for autoplay. However the runtime never inserts the `<video>` element into the DOM: `DomRenderer` renders `kind:'video'` payloads as plain `<div>`s (`renderer-dom.ts:221-258` — only `payload.html` is ever written), so video content is invisible in the DOM fallback and `frame-adapter.ts:64-76` emits no poster `<img>` either.
- DPR: quality ladder floors at 0.5 (`quality.ts:39-46`) and `dpr.max` is hard-coded to 2 (`capabilities.ts:105`) — a reasonable mobile GPU floor, though the controller *starts* at the top rung (`quality.ts:76-78`) and burns battery stepping down; consider starting mid-ladder on `deviceMemoryGB <= 4`.

---

## 4. Asset pipeline edge cases

### P1 — Manifest does not validate video `duration` or variant `url` strings → runtime crash / NaN
- `manifest.ts:58-65` checks only that `variants` is a record with some variant key; it never checks that `variants.mp4.url`/`webm.url`/`hls.playlist` are strings, and never checks `duration` is a finite number. Consequences:
  - `loader.ts:186-191`: when a video has `hls` only, `canPlayNativeHls` false, and no hls.js — fine; but if `variants.mp4` exists with a non-string `url`, `progressive` is not a string and line 191 `url.startsWith(...)` throws `TypeError`. If *no* variant resolves at all, `progressive as string` (`:189`) is `undefined` → same crash.
  - Non-finite `duration` propagates into `LoadedVideo.duration` and `seekTo` clamping (§1).
- Fix: in `validateEntry` require each present variant to have `typeof url === 'string'` (and `playlist` for hls), and `Number.isFinite(entry.duration) && entry.duration >= 0` for video.

### P2 — Cache API failure poisons the persistent tier permanently
- `cache.ts:172-176`: `this.cachePromise ??= caches.open(...)` — if `caches.open` rejects once (private mode, quota), the rejected promise is cached forever and `get()`/`set()` always fall into the `catch` → the IndexedDB fallback is never tried again. QuotaExceededError on `cache.put`/`idbSet` is swallowed (acceptable best-effort), but zero-byte/corrupt cached payloads are returned without validation (`get()` returns any matched ArrayBuffer).
- Fix: reset `cachePromise = null` on rejection; validate `byteLength > 0` before returning a hit.

### P2 — Cross-origin decode failures & CORS
- `loadImage` uses `fetch` + `createImageBitmap` (`loader.ts:285-296`): a CDN without CORS headers fails the fetch even though an `<img>` would render — no `Image`-element fallback. Videos set `el.src` cross-origin (fine for playback) but any future `createImageBitmap(video)`/texture upload will taint/fail; no `crossOrigin` attribute is set anywhere. Fonts: `face.load()` rejection is treated as asset error — correct — but the font stays partially registered in edge cases (`document.fonts.add` only after load — OK).

### SOLID (assets)
- Per-asset failures never reject the preload run; abort drains the queue with AbortError results (`preload.ts:119-152`); concurrent `preload()` calls abort the previous run (`manager.ts:79`); dispose aborts in-flight loads and releases video/font handles; CDN base trailing-slash handled (`manifest.ts:126-128`); duplicate/ mismatched entry ids rejected (`manifest.ts:37-39`); zero-byte fetches fail naturally at decode and are reported as asset errors; no blob URLs are created, so no revocation leak.

---

## 5. Templates / examples

### P0 — Scroll-video scrub is a no-op end-to-end in every shipped example
Two compounding defects, both verified in generated output:
1. **Duration collapses to 0.** `examples/*/build-example.mjs:39` builds the manifest via `manifestFromAssetRefs`, which synthesizes video entries with `duration: 0` (`runtime/src/ir.ts:103-113`). The scroll templates take `videoAsset.duration` when the asset exists (`scroll-video.ts:75`, `scroll-cinema-landing.ts:117`: `videoAsset?.kind === 'video' ? videoAsset.duration : totalRange`), so `videoDuration = 0` wins over the fallback. Verified in dist: `examples/scroll-cinema-landing/dist/main.ba547c0c56.js` contains `track-stage-scrub … keyframes:[{"t":0,"value":0},{"t":10,"value":0}]` — scrolling maps to playback time 0..0.
2. **The value never reaches a video anyway.** The scrub binding targets property `'playback.time'` (`scroll-video.ts:96`), but `setByPath` (`scene/src/binding.ts:27-38`) writes onto the SceneNode, which has no `playback` key — the write silently returns false. No renderer reads `playback.time`, and no code calls `LoadedVideo.seekTo()` from the frame loop at all.
- Fix: (a) treat `duration <= 0`/non-finite as "unknown" and fall back to `totalRange` in both scroll templates; (b) emit real durations into the build manifest instead of the zeroed synthetic one; (c) route playback: engine frame loop should resolve `video-plane` nodes to their loaded asset and call `seekTo(value)` (throttled), i.e. handle `playback.time` as a first-class binding path in `frame-adapter`/engine rather than a node property write.

### P1 — `cinematic-story` with `durationOrRange: 0` corrupts the global clock
- `cinematic-story.ts:170` uses `?? 6` (not `|| 6`): an act with `durationOrRange: 0` yields `dur = 0`, then `clock += 0 - CROSSFADE_S` (`:172`) makes `clock` **negative**, shifting all subsequent act windows before t=0. Exactly-2-acts is fine (slot min 2), and `crossfadeKeyframes` handles `dur < 2*xfade` via `f = min(xfade, dur/2)` (`:81`), but `dur = 0` still produces four identical-t keyframes. `durationHint` is guarded (`:94` requires `> 0`) — the `track.durationOrRange` path is not. Title/credits use `||` (`:163,177`) — inconsistent.
- Fix: `const dur = durationHint(scene) ?? (scene.track.durationOrRange > 0 ? scene.track.durationOrRange : 6);` and clamp `clock = Math.max(0, clock + dur - CROSSFADE_S)`.

### P2 — scroll-cinema-landing edge cases
- Zero chapters: guarded (`:203` ternary) — OK. Negative `durationOrRange` (passes config validation?) yields negative `totalRange` (`:103-106` — `||` only catches 0/NaN, not negatives) → inverted windows and `slice < 0`. Explicit `meta.scrollRange` is validated (`r[1] > r[0]`, `:84`) but nothing clamps it into `[0, totalRange]`; a window beyond totalRange is dead scroll space. `chapterWindowKeyframes` is safe for tiny `dur` (lead = 12% both sides, ordering holds).
- Binding output ranges can mismatch track ranges: `resolveBindings` (`internal.ts:137-147`) uses the *config scene's* `durationOrRange` as `outputRange` end, while template tracks use `totalRange` — e.g. simple-site: binding outputs 0..8 onto a scrub track whose range is 0..12 (verified in dist: `track-hero-scrub` range `[0,12]`). Scrub stalls at 2/3 travel. Fix: pass the composed track's range into `resolveBindings` instead of the config value.

### P3 — SSR/codegen markup
- `ssrSkeleton` (`common.ts:163-166`) injects `n.html` **unescaped** into `index.html` — intended for trusted config HTML, but worth a documented trust note. JSON embedding is properly `</script>`-escaped (`emit.ts:190-197`). All example configs parse cleanly through `parseConfig` (verified: simple-site, scroll-cinema-landing, cinematic-story all `ok:true`, JSONC comments handled by `stripJsonComments`).
- Examples reference `https://media.example.com/...` placeholder URLs: behavior verified — loads fail, `engine:error` fires, boot continues (by design), but because of §1's silent-error finding the user sees a black page with no message.
- Webcomponent target (`gen-webcomponent.ts`): `connectedCallback` async boot races `disconnectedCallback` — disconnect during boot leaves a running engine; `attributeChangedCallback` boots a **second** engine into the same host without disposing the first. P2. Fix: track a boot token/generation and dispose the previous engine before rebooting.

---

## Prioritized fix plan

### FB1 — P0/P1: make generated sites actually run & fail loudly (must)
1. Resolve the bare `'@lumen/runtime'` specifier for target `static` (import map or build-time bundle) — *blocks all examples in a real browser*.
2. Wire video scrubbing end-to-end: duration fallback in `scroll-video.ts:75` / `scroll-cinema-landing.ts:117` (`> 0` check), real durations in the build manifest, and a `playback.time` path handled in the engine/frame-adapter that calls `LoadedVideo.seekTo()`.
3. Generated entry: `main().catch(...)` + `engine:error` subscription with visible fallback (`gen-static.ts`, `gen-runtime.ts`, `gen-webcomponent.ts`).
4. `plugin.ts initAll`: rethrow non-recoverable init failures (or fail `kernel.start()`).

### FB2 — P1: boot/dispose hygiene + manifest validation (must)
5. `bootEngine` try/catch → `kernel.dispose()` + canvas removal on partial boot failure; guard double-boot on the same root.
6. `manifest.ts` video validation: variant url/playlist string checks, finite `duration ≥ 0`.
7. `loader.ts` loadVideo: guard missing/undefined variant URLs before `url.startsWith`; seekTo finite-duration clamp + error/timeout rejection.

### FB3 — P1/P2: mobile input & viewport (must for scroll templates, should otherwise)
8. Touch path into the virtual scroller (pan→delta mapping or native-scroll wiring from codegen); `touch-action` in `criticalCss`; resolve passive-wheel double-scroll.
9. `100dvh` fallback, `viewport-fit=cover`, `visualViewport.resize` alongside `window.resize`.

### FB4 — P2: resource lifecycle (should)
10. `AssetManager.dispose`: close ImageBitmaps, stop wiping the persistent cache; WebGLRenderer dispose geometries/materials; `webglcontextlost` handling.
11. PersistentCache: reset `cachePromise` on rejection, skip zero-byte hits; optional CORS-free `<img>` fallback for image decode.
12. Webcomponent boot generation token + dispose-before-reboot.

### FB5 — P2/P3: template/polish (could)
13. `cinematic-story` `?? → >0` duration guard + non-negative clock clamp; negative `totalRange` guard in scroll-cinema-landing; align `resolveBindings` outputRange with composed track ranges.
14. Scheduler re-check `running` before re-scheduling; negative-delta clamp.
15. iOS `DeviceOrientationEvent.requestPermission` flow; document SSR html trust boundary; consider mid-ladder quality start on low-memory devices.
