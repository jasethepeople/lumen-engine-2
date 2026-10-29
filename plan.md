# Plan — Phase 7: Build the Real App

## Goal
Three additive sub-projects under /mnt/agents/output/engine/app/: builder (React+TS+Tailwind+Vite UI), runtime (config loading + engine boot + template mounting), cli (ffmpeg hybrid asset variants + manifests).

## Cross-agent contract (fixed by orchestrator, all agents code against it)
- `app/runtime` package `@lumen/app-runtime` exports:
  - `createLumenApp(input: unknown | string, opts?: { registry?: TemplateRegistry }): Promise<LumenApp>`
  - `LumenApp = { config: EngineConfig; composedScene; manifest; boot(rootEl: HTMLElement): Promise<EngineHandle>; dispose(): void }`
  - wraps root engine `createEngine` (packages/index.ts) + `createExtendedRegistry()` (+ product-showcase once added).
- Templates available: 'scroll-video' (scroll-cinema-landing via extended registry), 'cinematic-spa' (cinematic-story), 'viewer-3d' (product-showcase NEW — added to packages/templates as kind 'viewer-3d' specialization, additive, extended registry only).

## Waves (parallel)
- **Agent A — runtime + template**: product-showcase template in packages/templates (tests), app/runtime package, demo HTML mounting all three templates, tests.
- **Agent B — CLI**: app/cli Node ESM CLI `lumen-media`: ffmpeg wrapper (scrub MP4 GOP=1, WebP/AVIF frame stacks), manifest writer emitting IRAssetRef-compatible variants JSON. Tests with synthetic inputs where ffmpeg absent (skip-graceful).
- **Agent C — builder UI**: app/builder Vite+React+TS+Tailwind: config editor (form-driven for scenes/assets/tracks/theme + JSON view), preview pane booting real engine via @lumen/app-runtime, reduced-motion toggle (MotionPolicy), template picker, export config JSON. Uses Vite aliases to packages/*/dist.

## Integration
Orchestrator merges all branches, builds everything, validates engine suites stay green, builds the builder app, saves website version.
