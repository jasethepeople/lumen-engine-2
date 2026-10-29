# Templates: the four frontend types

A Lumen site is exactly one `TemplateKind`. Each kind is implemented by a
`TemplateDescriptor` in `@lumen/templates` — a plain TypeScript module
declaring slots, theme defaults, required capabilities, performance budgets,
and a `compose(config, manifest)` function that maps your config into a
`ComposedScene`.

```ts
import {
  scrollVideoTemplate,
  cinematicSpaTemplate,
  viewer3dTemplate,
  storytellingTemplate,
  createDefaultRegistry,
} from '@lumen/templates';

const registry = createDefaultRegistry();
const descriptor = registry.get('scroll-video'); // by TemplateKind
```

Conventions: config scene ids map to `node-<sceneId>` groups and
`track-<sceneId>` timeline tracks (storytelling block tracks are suffixed
`-enter` / `-progress` / `-exit`); template metadata is namespaced on nodes
under `meta['<template-kind>']`.

## At a glance

| Template        | Slots (`min..max`)                                              | Track drivers                          | Renderers          | Asset features | Interactions                       |
| --------------- | -------------------------------------------------------------- | -------------------------------------- | ------------------ | -------------- | ---------------------------------- |
| `scroll-video`  | `stage` (1..1, video-plane), `caption`                          | scroll (scrub)                         | webgl2, canvas2d   | hls            | scroll, touch                      |
| `cinematic-spa` | `hero` (1..1), `gallery` (0..16), `outro` (0..1)                | time (sequenced clock)                 | webgl2, dom        | hls, lottie    | scroll, pointer, keyboard          |
| `viewer-3d`     | `model` (1..1, mesh), `hotspot` (0..16)                         | pointer (orbit)                        | webgl2             | draco, ktx2    | pointer, touch, deviceorientation  |
| `storytelling`  | `block` (1..128, dom), `media` (0..64), `sticky-media` (0..8)   | scroll (enter/progress/exit per block) | dom, canvas2d      | hls, lottie    | scroll, keyboard                   |

The `Renderers`/`Asset features`/`Interactions` columns are each template's
`ModuleRequirement` — codegen tree-shakes to exactly these modules.

## When to use which

- **`scroll-video`** — a single full-bleed video scrubbed by scroll position,
  with caption overlays. Product films, hero reels. Requires one `stage`
  scene whose node references a video asset (HLS supported via dynamic import
  with native-HLS fallback).
- **`cinematic-spa`** — a time-sequenced, choreographed single-page
  experience: a hero, an optional gallery, an outro. Keynote-style landing
  pages where motion runs on the clock, not the scrollbar.
- **`viewer-3d`** — an orbital 3D model viewer: one mesh in the `model` slot
  (GLTF/GLB, Draco/KTX2 pipelines declared), DOM/sprite `hotspot` overlays.
  Product configurators, portfolio pieces. Pointer/touch/deviceorientation
  drive the orbit.
- **`storytelling`** — long-form scrollytelling: text `block`s (DOM),
  interleaved `media`, and spatial `sticky-media` that pins while blocks pass.
  Articles, reports, narrative explainers. DOM-first and keyboard-friendly.

## Minimal configs

All four share the same `EngineConfig` skeleton; only `template`, slots, and
node kinds differ. `build`/`theme`/defaults omitted for brevity.

### scroll-video

```jsonc
{
  "version": 3,
  "id": "film",
  "template": "scroll-video",
  "meta": { "title": "Film", "description": "Scrub the film.", "locale": "en" },
  "assets": [{ "id": "reel", "src": "./reel.mp4", "kind": "video", "preload": "critical" }],
  "scenes": [
    {
      "id": "reel",
      "slot": "stage",
      "nodes": [{ "id": "reel-plane", "kind": "video-plane", "assetId": "reel" }],
      "track": { "driver": "scroll", "durationOrRange": 12 },
      "a11y": { "label": "Reel" }
    },
    {
      "id": "caption-1",
      "slot": "caption",
      "nodes": [{ "id": "cap-1", "kind": "dom", "html": "<h1>Hello</h1>" }],
      "track": { "driver": "scroll", "durationOrRange": 4 },
      "a11y": { "label": "Opening caption" }
    }
  ],
  "interactions": [
    { "id": "scroll-reel", "source": "scroll", "scene": "reel", "inputRange": [0, 1], "a11yFallback": "steps" }
  ],
  "theme": {},
  "build": { "target": "static", "ssr": true }
}
```

### cinematic-spa

```jsonc
{
  "version": 3,
  "id": "launch",
  "template": "cinematic-spa",
  "meta": { "title": "Launch", "description": "Keynote page.", "locale": "en" },
  "assets": [
    { "id": "hero-bg", "src": "./hero.mp4", "kind": "video" },
    { "id": "mark", "src": "./mark.json", "kind": "lottie" }
  ],
  "scenes": [
    {
      "id": "hero",
      "slot": "hero",
      "nodes": [{ "id": "hero-plane", "kind": "video-plane", "assetId": "hero-bg" }],
      "track": { "driver": "time", "durationOrRange": 8 },
      "a11y": { "label": "Hero" }
    }
  ],
  "interactions": [],
  "theme": {},
  "build": { "target": "static", "ssr": true }
}
```

### viewer-3d

```jsonc
{
  "version": 3,
  "id": "product",
  "template": "viewer-3d",
  "meta": { "title": "Product", "description": "Spin it.", "locale": "en" },
  "assets": [{ "id": "shoe", "src": "./shoe.glb", "kind": "model", "preload": "critical" }],
  "scenes": [
    {
      "id": "model",
      "slot": "model",
      "nodes": [{ "id": "shoe-mesh", "kind": "mesh", "assetId": "shoe" }],
      "track": { "driver": "pointer", "durationOrRange": 1 },
      "a11y": { "label": "3D model" }
    },
    {
      "id": "hotspot-sole",
      "slot": "hotspot",
      "nodes": [{ "id": "hs-sole", "kind": "dom", "html": "<button>Sole</button>" }],
      "track": { "driver": "pointer", "durationOrRange": 1 },
      "a11y": { "label": "Sole detail" }
    }
  ],
  "interactions": [
    { "id": "orbit", "source": "pointer", "gesture": "pan", "scene": "model", "inputRange": [0, 6.283], "a11yFallback": "steps" }
  ],
  "theme": {},
  "build": { "target": "webcomponent" }
}
```

### storytelling

```jsonc
{
  "version": 3,
  "id": "story",
  "template": "storytelling",
  "meta": { "title": "Story", "description": "A scrollytelling piece.", "locale": "en" },
  "assets": [{ "id": "chart", "src": "./chart.png", "kind": "image" }],
  "scenes": [
    {
      "id": "intro",
      "slot": "block",
      "nodes": [{ "id": "intro-text", "kind": "dom", "html": "<p>It began…</p>" }],
      "track": { "driver": "scroll", "durationOrRange": 1 },
      "a11y": { "label": "Introduction" }
    },
    {
      "id": "chart-media",
      "slot": "sticky-media",
      "nodes": [{ "id": "chart-img", "kind": "sprite", "assetId": "chart" }],
      "track": { "driver": "scroll", "durationOrRange": 3 },
      "a11y": { "label": "Chart", "summary": "Growth over time." }
    }
  ],
  "interactions": [
    { "id": "scroll-story", "source": "scroll", "scene": "intro", "inputRange": [0, 1], "a11yFallback": "steps" }
  ],
  "theme": {},
  "build": { "target": "static", "ssr": true }
}
```

## Custom templates

You can register your own `TemplateDescriptor` (slots, theme defaults,
capabilities, budgets, `compose`). See [extending.md](extending.md#custom-templates).
