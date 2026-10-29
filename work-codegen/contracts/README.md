# @lumen/contracts

Frozen cross-module contract types for the Lumen engine. Every type shared
between modules (kernel, rendering, scene, assets, interaction, templates,
config, codegen, build) lives here and **only** here.

## Rules

- **This package is orchestrator-owned and frozen.** Module agents must not
  modify it. If a gap is found, implement a local adapter in your module and
  note it in your module README (see SPEC.md, Sacred Rules).
- Pure type declarations plus tiny pure helpers only: no runtime dependencies,
  no DOM access at import time.

## Consuming

```ts
import type { EngineConfig, IRenderer, ComposedScene } from '@lumen/contracts';
```

The package is an npm workspace member (`contracts/`). Build it once before
typechecking modules:

```sh
npm install            # repo root (installs typescript)
cd contracts && npm run build   # emits dist/ + .d.ts
```

## Layout

- `src/kernel.ts` — lifecycle, event map, capabilities, plugins, budget reports
- `src/rendering.ts` — IRenderer, RenderFrame, CameraState, QualityLevel
- `src/scene.ts` — SceneNode, Transform, TimelineTrack, Keyframe, ComposedScene
- `src/assets.ts` — AssetManifest, per-kind AssetEntry types, PreloadStrategy
- `src/interaction.ts` — NormalizedInputEvent, InteractionBinding, VirtualScroller
- `src/templates.ts` — TemplateDescriptor, SlotDefinition, ThemeTokens, ModuleRequirement
- `src/config.ts` — EngineConfig, SceneConfig, AssetRef, ConfigMigration
- `src/codegen.ts` — CodegenTarget, CodegenResult, CodegenOptions
- `src/build.ts` — BuildArtifact, BuildOptions, SizeBudget
