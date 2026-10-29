# 02 — Custom Templates

A Lumen template is not string templating — it is a plain TypeScript object
implementing the **`TemplateDescriptor`** contract
(`contracts/src/templates.ts`). This guide walks you through writing,
registering, and shipping one.

> The short version also lives in
> [../extending.md](../extending.md) ("Custom templates"). This guide is the
> full walkthrough, modeled on the real `scroll-video` implementation in
> `packages/templates/src/scroll-video.ts`.

## The TemplateDescriptor contract

Every field, verbatim from the contract:

| Field                  | Type                    | Meaning |
| ---------------------- | ----------------------- | ------- |
| `kind`                 | `TemplateKind`          | Which frontend type this descriptor implements: `'scroll-video' \| 'cinematic-spa' \| 'viewer-3d' \| 'storytelling'`. |
| `version`              | `string`                | Descriptor semver (e.g. `'0.1.0'`). |
| `slots`                | `SlotDefinition[]`      | Regions config scenes may populate (see below). |
| `themeTokens`          | `ThemeTokens`           | Default theme; `EngineConfig.theme` overrides are merged over it. |
| `requiredCapabilities` | `ModuleRequirement`     | Tree-shaking contract: exact `renderers`, `assetFeatures`, and `interactions` codegen must include. |
| `budgets`              | `PerformanceBudget`     | Per-template perf budget: `jsGzBytes`, `criticalAssetBytes`, `firstFrameMs`. |
| `compose`              | `(cfg, manifest) => ComposedScene` | Maps a validated config + asset manifest into a resolved scene. |

### SlotDefinition

| Field     | Type                                   | Meaning |
| --------- | -------------------------------------- | ------- |
| `id`      | `string`                               | Referenced by `SceneConfig.slot` in configs. |
| `accepts` | `SceneNodeKind[]`                      | Node kinds allowed here (`'group'`, `'mesh'`, `'video-plane'`, `'dom'`, `'camera'`, `'light'`, `'sprite'`). |
| `min`     | `number`                               | Minimum scenes required. |
| `max`     | `number`                               | Maximum scenes allowed. |
| `region`  | `'dom' \| 'spatial' \| 'hybrid'`       | Where the slot renders (DOM overlay vs. 3D surface vs. both). |

The registry's `validate()` checks scene→slot assignment, `accepts`, and
`min`/`max` — but reports **warnings, never errors**: slot validation never
blocks composition.

### What compose() must return

`compose(cfg, manifest)` returns a `ComposedScene`:

```ts
interface ComposedScene {
  sceneGraph: SceneNode[];                 // root nodes of the node tree
  tracks: TimelineTrack[];                 // all timeline tracks
  bindings: InteractionBinding[];          // resolved interaction bindings
  hydration: { ssr: boolean; islands: string[] };  // hints for codegen/runtime
}
```

Structural invariants (unique node/track ids, tracks targeting real nodes,
bindings targeting real tracks) are asserted by the shared `assembleScene()`
helper, so use it rather than hand-assembling the object.

## Step by step: a minimal custom template

We will build `fade-gallery`: one full-viewport image (`sprite`) cross-faded
by scroll, with one DOM caption slot. It reuses the `scroll-video` kind —
see the gotcha below about `TemplateKind`.

### 1. Declare the slots

```ts
import type { TemplateDescriptor } from '@lumen/contracts';

export const FADE_GALLERY_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'image',   accepts: ['sprite'],        min: 1, max: 8,  region: 'spatial' },
  { id: 'caption', accepts: ['dom'],           min: 0, max: 8,  region: 'dom' },
];
```

### 2. Declare theme defaults

Reuse the shared scales from `packages/templates/src/theme.ts` (exported from
`@lumen/templates`): `defaultTypeScale()`, `defaultSpacing()`,
`defaultMotion()`.

```ts
import type { ThemeTokens } from '@lumen/contracts';
import { defaultMotion, defaultSpacing, defaultTypeScale } from '@lumen/templates';

export const FADE_GALLERY_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#101014',
    foreground: '#f4f4f6',
    accent: '#ffd28a',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: defaultMotion(),
};
```

### 3. Write compose()

Use the internal helper patterns from `packages/templates/src/internal.ts`:
`resetIds()`, `makeNode()`, `makeTrack()`, `nodeFromConfig()`,
`resolveBindings()`, and `assembleScene()`. (Those helpers are package-internal;
in your own module copy the small ones you need — `makeNode`, `makeTrack`,
`identityTransform` are a few lines each, shown below.)

```ts
import type {
  ComposedScene,
  EngineConfig,
  AssetManifest,
  SceneNode,
  TimelineTrack,
  Transform,
} from '@lumen/contracts';
import { resolveThemeTokens } from '@lumen/templates';

// --- minimal local helpers (same shapes as templates/src/internal.ts) ---
const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotationQuat: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

function makeNode(init: Partial<SceneNode> & Pick<SceneNode, 'id' | 'kind'>): SceneNode {
  return {
    transform: identityTransform(),
    layer: 0,
    visible: true,
    bindings: [],
    children: [],
    ...init,
    transform: { ...identityTransform(), ...init.transform },
  };
}

function makeTrack(
  id: string,
  target: string,
  driver: TimelineTrack['driver'],
  range: [number, number],
  keyframes: TimelineTrack['keyframes'],
): TimelineTrack {
  return { id, target, driver, range, keyframes };
}

function composeFadeGallery(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  const theme = resolveThemeTokens(FADE_GALLERY_THEME_DEFAULTS, cfg.theme);

  const imageScenes = cfg.scenes.filter((s) => s.slot === 'image');
  const captionScenes = cfg.scenes.filter((s) => s.slot === 'caption');
  const totalRange =
    cfg.scenes.reduce((sum, s) => sum + (s.track.durationOrRange || 1), 0) || 1;

  const tracks: TimelineTrack[] = [];
  const sceneRefs = new Map<string, { nodeId: string; trackId: string }>();
  const roots: SceneNode[] = [];

  // One sprite node per image scene, each cross-faded by a scroll track.
  let offset = 0;
  for (const scene of imageScenes) {
    const dur = scene.track.durationOrRange || 1;
    const nodeId = `node-${scene.id}`;
    const trackId = `track-${scene.id}`;
    const spriteCfg = scene.nodes.find((n) => n.kind === 'sprite' && n.assetId);

    tracks.push(
      makeTrack(trackId, nodeId, 'scroll', [offset, offset + dur], [
        { t: offset, value: 0, easing: 'ease-in' },
        { t: offset + dur * 0.2, value: 1 },
        { t: offset + dur * 0.8, value: 1 },
        { t: offset + dur, value: 0, easing: 'ease-out' },
      ]),
    );

    roots.push(
      makeNode({
        id: nodeId,
        kind: 'sprite',
        layer: 0,
        payload: { assetId: spriteCfg?.assetId ?? '' },
        bindings: [{ trackId, property: 'material.opacity' }],
        meta: { 'scroll-video': { slot: 'image', a11y: scene.a11y, theme } },
      }),
    );
    sceneRefs.set(scene.id, { nodeId, trackId });
    offset += dur;
  }

  // Caption scenes: DOM overlay groups bound to their own fade track.
  for (const scene of captionScenes) {
    const dur = scene.track.durationOrRange || 1;
    const nodeId = `node-${scene.id}`;
    const trackId = `track-${scene.id}`;
    tracks.push(
      makeTrack(trackId, nodeId, 'scroll', [offset, offset + dur], [
        { t: offset, value: 0, easing: 'ease-in' },
        { t: offset + dur * 0.15, value: 1 },
        { t: offset + dur * 0.85, value: 1 },
        { t: offset + dur, value: 0, easing: 'ease-out' },
      ]),
    );
    const group = makeNode({
      id: nodeId,
      kind: 'group',
      layer: 1,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: { 'scroll-video': { slot: 'caption', a11y: scene.a11y } },
    });
    for (const nc of scene.nodes) {
      group.children.push(
        makeNode({
          id: nc.id,
          kind: nc.kind,
          layer: 2,
          payload: { html: nc.html ?? '' },
          bindings: [{ trackId, property: 'transform.position' }],
          meta: { 'scroll-video': { slot: scene.slot, a11y: scene.a11y } },
        }),
      );
    }
    roots.push(group);
    sceneRefs.set(scene.id, { nodeId, trackId });
    offset += dur;
  }

  // Resolve declarative interactions to concrete node/track targets.
  const bindings = cfg.interactions.flatMap((ic) => {
    const ref = sceneRefs.get(ic.scene);
    if (!ref) return []; // dangling interaction; registry.validate() reports it
    const end =
      cfg.scenes.find((s) => s.id === ic.scene)?.track.durationOrRange ?? 1;
    return [{
      id: ic.id,
      source: ic.source,
      ...(ic.gesture !== undefined ? { gesture: ic.gesture } : {}),
      targetNodeId: ref.nodeId,
      targetTrackId: ref.trackId,
      mapping: { inputRange: ic.inputRange, outputRange: [0, end] as [number, number] },
      a11yFallback: ic.a11yFallback ?? 'static',
    }];
  });

  const islands = captionScenes.map((s) => `node-${s.id}`);
  return {
    sceneGraph: roots,
    tracks,
    bindings,
    hydration: { ssr: captionScenes.length > 0, islands },
  };
}
```

Key conventions to copy from the built-in templates:

- **Naming**: `node-<sceneId>` for nodes, `track-<sceneId>` for tracks.
- **Metadata**: template-specific data goes under
  `meta['<template-kind>']` — keep `slot` and the scene's `a11y` there so
  codegen can emit per-scene accessibility metadata.
- **Themes**: resolve once at the top with
  `resolveThemeTokens(defaults, cfg.theme)` — never reimplement merging.
- **Property paths**: bindings use dotted paths like `'material.opacity'`,
  `'transform.position'`, `'playback.time'`.
- **Dangling interactions**: skip them; `registry.validate()` already warns.

### 4. Fill in the descriptor

```ts
export const fadeGalleryTemplate: TemplateDescriptor = {
  kind: 'scroll-video', // reuse a kind; see gotcha below
  version: '0.1.0',
  slots: FADE_GALLERY_SLOTS,
  themeTokens: FADE_GALLERY_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2', 'canvas2d'],
    assetFeatures: [],
    interactions: ['scroll', 'touch'],
  },
  budgets: {
    jsGzBytes: 120_000,
    criticalAssetBytes: 1_500_000,
    firstFrameMs: 1_500,
  },
  compose: composeFadeGallery,
};
```

> **Gotcha — `TemplateKind` is a frozen union.** `kind` must be one of the
> four existing strings; reusing a kind for a custom descriptor works today
> (the registry is a plain map). Adding a *new* kind string requires a
> contract change — see the CCP process in
> [../extending.md](../extending.md#contract-changes-ccp).

> **Gotcha — `requiredCapabilities` matters.** Codegen uses it to decide
> which renderer backends, asset features (`'hls' | 'draco' | 'lottie' | 'ktx2'`),
> and interaction sources the emitted bundle imports. Over-declaring bloats
> your JS budget; under-declaring breaks at runtime.

### 5. Register it

Use `TemplateRegistry.register()` (chainable), or extend the default set:

```ts
import { createDefaultRegistry, TemplateRegistry } from '@lumen/templates';

// Option A: alongside the built-ins (note: registering the same kind twice
// replaces the built-in — register your descriptor AFTER the defaults).
const registry = createDefaultRegistry().register(fadeGalleryTemplate);

// Option B: your own curated set.
const custom = new TemplateRegistry()
  .register(fadeGalleryTemplate);
```

### 6. Validate configs against your slots

```ts
const { valid, warnings } = registry.validate(config);
for (const w of warnings) console.warn(`${w.severity} ${w.path}: ${w.message}`);
```

Warnings cover: unknown slots, node kinds a slot doesn't `accept`, and
`min`/`max` violations per slot. They never block `compose()` — treat them as
author feedback in your build script.

### 7. How codegen and build consume your descriptor

- `generate(config, descriptor, scene, options)` (`@lumen/codegen`) reads
  `descriptor.themeTokens` (merged into the SceneIR) and
  `descriptor.requiredCapabilities` (drives emitted imports), then emits
  per-target modules. Nothing template-specific to do — your `compose()`
  output is the input.
- `build(config, generateFn)` (`@lumen/build`) just runs the pipeline over
  the codegen result. Your descriptor's `budgets` are the template-level
  contract; the build enforces its own `SizeBudget[]` (default: `js-gz` ≤
  170 KB, `css-gz` ≤ 40 KB, `critical-assets` ≤ 1.2 MB) — align your
  descriptor budgets with those numbers or pass explicit `budgets` to the
  build (see [04 — Building and exporting](04-building-and-export.md)).

For the SceneIR wire format that carries your scene to the browser, see
`contracts/src/ir.ts` and [../architecture.md](../architecture.md).
