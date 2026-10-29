# @lumen/app-builder — Lumen Builder UI

Visual builder for Lumen `EngineConfig`s: form-driven config editing on the
left, a **live preview booting the real engine** on the right.

## Prerequisites

The builder consumes the engine packages from their **built dists**, so from
the repo root first run:

```bash
bash scripts/build-all.sh
```

## Dev / build

```bash
cd app/builder
npm install        # react 18 + vite 5 + tailwind 3 + typescript
npm run dev        # vite dev server
npm run build      # tsc --noEmit (typecheck) + vite build → dist/
npm run typecheck
```

`dist/` is committed as build evidence (same convention as `examples/`).

## Platform views (Phases 8–13)

The Builder is a tab shell (`src/App.tsx`): **Editor** (the original
config editor + live preview + export), plus six views wired to the real
`@lumen/app-*` platform packages — no mocks beyond the packages' own
offline providers:

| View | Package wiring |
| --- | --- |
| Projects | `ProjectStore` (LocalStorageAdapter) list/create/duplicate/delete; open loads the config into the editor; every validated edit is persisted via `AutosaveManager.schedule` (debounced); version history dropdown + `restoreVersion` |
| Onboarding | `OnboardingWizard` step machine rendered step-by-step (tooltips + checklists from the package); template picker via a `TemplateProvider` over the marketplace catalog ∪ installed store; hero-media bytes held for the asset queue; chapters editor; theme picker from `THEME_PRESETS`; motion step previews `buildConfig()` in the real PreviewPanel; finish → `createProjectFromWizard` + open in editor; skippable |
| Marketplace | `TemplateCatalog` (BuiltinSource) search + category/tier/tag filters, deterministic SVG thumbnails, detail modal, `Marketplace.install`, `checkUpdates` badges, pro-tier lock via `EntitlementService.gateTemplate` |
| Assets | `AssetUploadQueue` over a real in-browser executor (`BrowserMediaExecutor`: probe via createImageBitmap/HTMLVideoElement, scrub pass-through, frame-stack raises the package's `FfmpegUnavailableError` with guidance for video); device-class badge from `detectDeviceClass` + settings override; pipeline profile from `pickPipelineProfile`; completed jobs emit hybrid manifests via `HybridManifestGenerator` into the `AssetLibrary`; small player preview via object URLs |
| Publish | `PublishService.publish` (StaticExporter → budgets → `MockVercelClient`) gated by `EntitlementService.assertCan('publish.vercel')` over the `MockBillingProvider` subscription; free users get an upgrade prompt; publish URL (`*.mock.vercel.app`), per-project history, per-record rollback |
| Settings | `SettingsStore` UI: reduced-motion system/on/off (`resolveReducedMotion` feeds the preview's `createLumenApp` reducedMotion option), theme preset picker applying tokens to the builder chrome, device-class override, telemetry opt-in toggle (default off; gates `TelemetryClient.track` for project-created / template-installed / publish events), mock plan switcher (free/pro via `MockBillingProvider`) |

Singletons live in `src/platform/services.ts`; React bindings in
`src/platform/hooks.ts`.

## Platform views (Phases 14–19)

Five more tabs plus marketplace monetization, again wired to the real
packages with only the packages' own offline providers:

| View | Package wiring |
| --- | --- |
| Team | `CollaborationService.shareProject`/`isShared`, `LocalStorageMembershipStore` role badges + owner-only role changes (`canManageMembers`), `InvitationService.invite` → copyable `lumen://invite/<token>` link, `PresenceTracker` heartbeat bar (5 s interval, 15 s window), `ActivityLog` feed appended on every action, `ConflictResolver` merge-suggestion inbox (accept applies the config as a new head via the store; dismiss) |
| Marketplace (upgraded) | Catalog = BuiltinSource ∪ `PRICED_TEMPLATES` ∪ `CreatorSource`; price badges from `getPricedTemplate`/`isPaidTemplateMeta`; Buy → `TemplatePurchases.purchaseTemplate` (MockTemplateBillingProvider) + `RevenueShareLedger.recordPurchase`; install gating via `canAccessTemplate(entitlements, user, meta, ownsTemplate)`. **Creator** sub-panel: `CreatorTemplateService.uploadTemplate` (metadata form + entryConfig JSON paste; `CreatorTemplateValidationError.issues` and parseConfig errors surfaced), `updateMeta`, `generatePreview` cards, earnings via `creatorEarnings` + `requestPayout` (scheduled payout shown) |
| AI | `generateSceneIRFromDescription` (HeuristicProvider) → PreviewPanel + Use-as-new-project / Load-into-editor; `suggestChapterStructure` (apply → scene a11y labels), `suggestMotionProfiles` (apply → `a11y.motion`), `suggestCameraTracks` (apply → camera node `meta.keyframes`); `tagAsset` + `detectColorwayVariants` over the real `AssetLibrary`; `recommendTemplates` over the marketplace catalog |
| Designer | Per-scene `TimelineEditor` keyframe lanes (add/move/remove, `EASING_LIBRARY` picker, segment editing), `createCameraTrackLanes` camera position/zoom lanes, undo/redo via the editor's `UndoStack`, `ScrubController` scrub bar with ±1-frame steps and evaluated values, `buildMotionGraph` SVG visualization with `reducedMotionOverlay` toggle highlighting fallback edges, Save → `timelineToConfig` written back into the editor config |
| Dashboard | `DashboardService.overview` cards + project table with latest publish status; `publishHistory` + `rollback`; `AnalyticsStore` views-by-day bars (a view is recorded on each preview open); `PreviewService.createPreview` → modal with real bundle budgets + PreviewPanel of the project config; `sharePreview` generates a copyable mock link with expiry |
| Community | `ProfileStore` create/edit with `avatarColorFor` deterministic avatars; `CommunityShowcase` gallery (templates + projects, deterministic thumbnails); showcase-publish for my creator templates and projects; `RemixService.remixTemplate` creates a real project (opened in the editor) with `attributionFor` shown; threaded `CommentService` per entry |

### Browser shims for the publish pipeline

`PublishService`'s `StaticExporter` runs `@lumen/build`'s hashing/budget
machinery, which imports `node:crypto` / `node:zlib` / `node:path` and uses
the `Buffer` global. `vite.config.ts` aliases those to
`src/platform/node-shims/`:

- **crypto** — synchronous SHA-256, byte-identical to Node (verified
  against coreutils `sha256sum`), so publish-record hashes match the CLI.
- **zlib** — `gzipSync` emitting a *valid* stored-deflate gzip member; its
  size is a deterministic conservative **upper bound** on Node's level-9
  size, so budgets are never looser in the browser.
- **path** — posix-only join/dirname/relative/resolve for bundle paths.
- **node-stubs** — throwing named-export stubs for builtins whose code
  paths are never executed in the browser (`CliExecutor`, `NodeFsSink`,
  the vendor pipeline).
- **buffer** — a TextEncoder-backed `Buffer.from` global installed in
  `main.tsx` (UTF-8 only — the only encoding the publish path uses).

### Building without npm install (no-symlink mounts)

The repo mount cannot create symlinks, so `npm install` is unavailable.
Build the builder in /tmp with the skill template toolchain:

```bash
rsync -a --exclude .git --exclude node_modules <repo>/ /tmp/engine-ui/
ln -s <template node_modules> /tmp/engine-ui/app/builder/node_modules
cd /tmp/engine-ui/app/builder
./node_modules/.bin/tsc --noEmit -p tsconfig.json   # typecheck
./node_modules/.bin/vite build                       # → dist/
cp -r dist <repo>/app/builder/dist                   # commit dist back
```

## Architecture

```
src/state/useConfig.ts        config state; every edit round-trips through
                              @lumen/config parseConfig (the real seam), so
                              form edits and raw-JSON edits share one pipeline
src/components/Editors.tsx    meta / theme tokens / scenes+nodes / assets /
                              interactions form editors
src/components/JsonEditor.tsx raw JSONC view; path-aware ValidationErrors from
                              parseConfig + template-slot warnings from
                              @lumen/templates TemplateRegistry.validate
src/components/PreviewPanel.tsx  boots the REAL engine (see below)
src/components/ExportPanel.tsx   config/SceneIR downloads + in-browser codegen
src/lumen/app-runtime-fallback.ts  local @lumen/app-runtime implementation
```

### How the preview wires the real engine

`PreviewPanel` calls `createLumenApp(config, { reducedMotion })` and
`app.boot(mountEl)` — the `@lumen/app-runtime` contract (Agent A's package in
`app/runtime`). Until that package's dist exists, `vite.config.ts` aliases
`@lumen/app-runtime` to `src/lumen/app-runtime-fallback.ts`, a faithful
implementation of the same contract built only on real seams:

1. `parseConfig` (@lumen/config) — validation + defaults + migrations.
2. `createExtendedRegistry()` (@lumen/templates) — template lookup.
3. `descriptor.compose(config, manifest)` → `ComposedScene`;
   `manifestFromAssetRefs` (@lumen/runtime) synthesizes the manifest.
4. `lowerToIR` (@lumen/codegen) → `SceneIR`.
5. `bootEngine(rootEl, ir, opts)` (@lumen/runtime).

Boot options used by the preview:

- `renderer: 'dom'` — the builder contract is the DOM renderer path (the
  WebGL backend drops dom/video-plane payloads).
- `kernel: { capabilities }` — a profile precomputed with
  `detectCapabilities()` (@lumen/kernel). This is required at master:
  `bootEngine` reads `kernel.capabilities` inside `assets.init` *before*
  `kernel.start()` probes them, so booting without a precomputed profile
  throws `BOOT_FAILED / "Capabilities are not available before boot"`.
  `KernelOptions.capabilities` is the engine's own seam for this.

Config changes re-boot debounced (600 ms); the previous `LumenApp` is
disposed and each boot gets a fresh mount element (`bootEngine` refuses a
root with `data-lumen-booted`). Wheel events over the preview feed the
runtime's virtual scroller (@lumen/interaction listens for `wheel` on the
boot root) and scrub scroll-driven tracks; time-driven tracks auto-play on
the frame loop.

### Reduced-motion toggle

Re-boots with `BootOptions.reducedMotion: true`, threaded through
`createLumenApp` opts — the real v1.1 motion seam. The runtime's
`createMotionPolicy` (packages/runtime/src/motion.ts) resolves `reveal`
mode per boot; a wire-declared `a11y[].motion` scene default still wins
(engine semantics, unchanged).

### Export

Honest about browser limits:

- Download / copy the `EngineConfig` JSON.
- Download the lowered `SceneIR` (`lowerToIR` + `serializeIR` run in-browser).
- "Generate static modules" runs the real `@lumen/codegen` `generate()`
  in-browser (pure string generation, no node: imports) and offers each
  emitted file for download.
- The bundling/asset-pipeline step (`packages/build`) needs Node; the panel
  shows the exact CLI command instead of faking it:

  ```bash
  bash scripts/build-all.sh && node app/cli/dist/index.js build engine.config.json --out dist
  ```

### Vite aliases

All `@lumen/*` specifiers alias to `../../packages/<pkg>/dist` (built
dists; single module instances — the root `node_modules/@lumen/*` shims
would double-instantiate packages). `@lumen/app-runtime` aliases to
`../runtime/dist/index.js` when present, else the local fallback above.
