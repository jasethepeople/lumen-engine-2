# Lumen Engine — Stabilization Report (v0.2)

Final QA/stabilization pass over engine, templates, and example configs. Branch `agent/qa-fixes-2`, merged at `0accb2b` (+ merge-recovery commit).

## Risk findings & fixes applied

### Runtime risks
| Finding | Fix |
|---|---|
| Video scrub duration unknown → NaN/degenerate tracks | Additive `duration?: number` on `AssetRef`/`IRAssetRef` (schema-validated); scroll templates fall back to `totalRange`; `seekTo` finite-clamped with 5s timeout + error-event rejection |
| Plugin init failure silently swallowed | `plugin.initAll` emits `engine:error` AND rethrows; `kernel.start()` rejects (BOOT_FAILED) |
| Boot crashes left engine half-attached | engine boot try/catch → `kernel.dispose()` + canvas removal; double-boot guard via `dataset.lumenBooted`; generated HTML emits `.catch` + `role="alert"` fallback + `lumen:boot-error` event |
| Scheduler kept looping after stop | re-checks `running` before re-scheduling; negative dt clamped |
| WebGL context loss / resource leaks | renderer disposes pooled geometries/materials; `webglcontextlost`/`restored` handled; `<lumen-embed>` generation-token boot + dispose-before-reboot |

### Browser compatibility
| Finding | Fix |
|---|---|
| Bare `@lumen/*` imports in generated code unresolvable in browsers | `importMapScript()` emitted in static `index.html`; build pipeline vendors compiled runtime packages into `dist/vendor/<pkg>/` (default on for static target; excluded from budgets) |
| iOS deviceorientation requires permission | `DeviceOrientationEvent.requestPermission` gated behind first user gesture |
| 100vh mobile chrome bug | critical CSS emits `100vh` + `100dvh` fallback; viewport meta `viewport-fit=cover`; engine listens to `visualViewport.resize` |

### Mobile responsiveness
- Passive `touchstart/move/end/cancel` now feed the virtual scroller (`-delta[1]` mapping) — previously wheel-only, so scroll-video was dead on touch devices
- `touch-action: pan-y` in critical CSS; snap points and reduced-motion instant mode unchanged

### Asset pipeline edge cases
- Manifest validates video variant `url`/`playlist` strings + finite `duration >= 0` (`ManifestError`)
- Loader guards missing variant URLs before `startsWith` probing
- `AssetManager.dispose()` closes `ImageBitmap`s, disposes video/font handles, clears ONLY the memory LRU (persistent Cache API/IDB intact)
- `PersistentCache` resets `cachePromise` on rejection; skips zero-byte hits

### Template edge cases
- `cinematic-story` act duration floor 0.1s; clock clamped non-negative
- `resolveBindings` accepts composed track ranges (all 6 templates updated); negative `durationOrRange` guarded
- Chapter `scrollRange` clamped to `[0, totalRange]`
- Video elements verified muted/playsinline/preload (autoplay policy safe)

### Deferred (P3, documented)
`<img>` CORS fallback for image decode; SSR html trust-model doc note; mid-ladder quality start.

## Final validation (all on master, clean rebuild)

- `scripts/build-all.sh` — OK, 12 compilations, zero tsc errors
- E2E: **8/8 pass** (incl. new `qa-scrub-vendor` suite: import map coverage over every bare `@lumen` import in vendored files, scrub keyframes nonzero)
- Package tests: kernel 19, scene 19, rendering 25, assets 34, interaction 45, templates 29, config 14, codegen 23, build 2, runtime 4 — **214 pass / 0 fail**
- All three examples (`simple-site`, `scroll-cinema-landing`, `cinematic-story`) rebuild cleanly — **budgets PASSED**; dists regenerated and committed

## Stable component summary

- **Engine**: 11 packages + frozen contracts (now incl. `ir.ts` + additive `duration`), unified build convention, single entry `index.ts` → `createEngine()`
- **Templates**: 6 descriptors (4 default + `scroll-cinema-landing`, `cinematic-story` via `createExtendedRegistry()`); layering invariants (video z=0 / chapters z=10 / hero+outro z=20 / logo z=30); scroll-window transitions and 1.2s crossfade model; reduced-motion handling
- **Examples**: 3 runnable configs → static dist with hashed entry, SSR shell, import map, vendored runtime, hydration manifest, budget report
