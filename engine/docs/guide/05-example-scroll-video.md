# 05 — Worked Example: A Scroll-Video Site

End to end: a minimal scroll-video page from config to built site, using the
checked-in `examples/simple-site/`. Everything below is real — you can run it
verbatim.

## 0. Build the workspace

```sh
cd /path/to/engine
npm install
npm run build     # scripts/build-all.sh — see 04 for LUMEN_TSCJS if tsc isn't found
```

## 1. The config

`examples/simple-site/engine.config.json` (JSONC — comments allowed),
annotated:

```jsonc
{
  "version": 3,
  "id": "simple-site",
  "template": "scroll-video",          // the scroll-scrubbed video frontend type
  "meta": {
    "title": "Lumen Simple Site",
    "description": "A minimal scroll-scrubbed video site built with the Lumen engine.",
    "locale": "en"
  },
  "theme": {
    "colors": {                        // merged over the scroll-video theme defaults
      "background": "#0b0b10",         // → --lumen-color-background
      "foreground": "#f5f5f0",
      "accent": "#8ab4ff"
    }
  },
  "assets": [
    {
      "id": "hero-video",
      "src": "https://media.example.com/lumen/hero.mp4",  // placeholder remote URL
      "kind": "video",
      "preload": "critical"            // fetched during the kernel 'loading' phase
    },
    {
      "id": "hero-poster",
      "src": "https://media.example.com/lumen/hero-poster.jpg",
      "kind": "image",
      "preload": "eager"
    }
  ],
  "scenes": [
    {
      "id": "hero",
      "slot": "stage",                 // scroll-video slot: exactly 1 scene, video-plane only
      "nodes": [
        { "id": "hero-video-plane", "kind": "video-plane", "assetId": "hero-video" }
      ],
      "track": { "driver": "scroll", "durationOrRange": 8 },  // 8 scroll units of stage
      "a11y": {
        "label": "Hero background video",
        "summary": "A slow pan over an abstract landscape, scrubbed by scrolling."
      }
    },
    {
      "id": "captions",
      "slot": "caption",               // scroll-video slot: 0–32 scenes, dom/sprite nodes
      "nodes": [
        {
          "id": "caption-title",
          "kind": "dom",
          "html": "<h1>Lumen</h1><p>Scroll-driven cinematic sites from a single config.</p>"
        },
        {
          "id": "caption-sub",
          "kind": "dom",
          "html": "<p>Built with contracts, kernels and templates — no framework lock-in.</p>"
        }
      ],
      "track": { "driver": "scroll", "durationOrRange": 4 },  // captions live in scroll units 8–12
      "a11y": {
        "label": "Introduction captions",
        "summary": "Title and tagline shown over the hero video."
      }
    }
  ],
  "interactions": [
    {
      "id": "scroll-main",
      "source": "scroll",              // page scroll drives the hero scene's track
      "scene": "hero",
      "inputRange": [0, 1],            // viewport-normalized input domain
      "a11yFallback": "steps"          // reduced motion → discrete caption steps
    }
  ],
  "build": { "target": "static", "ssr": true, "minify": false }
}
```

How composition reads this (from `packages/templates/src/scroll-video.ts`):

- The **stage** scene becomes one full-viewport `video-plane` node
  (`node-hero-video`) with a scroll-driven **scrub track**
  (`track-hero-scrub`) over `[0, 12]` (total of all scenes'
  `durationOrRange`: 8 + 4), bound to the node's `playback.time` property —
  scrolling scrubs the video playhead from 0 to the video's duration.
- The **caption** scene becomes a `group` node (`node-captions`) containing
  the two `dom` children, with a scroll-driven fade track over `[8, 12]`:
  fade in over the first 15%, hold, fade out over the last 15%. Both dom
  nodes bind to that track.
- The **interaction** resolves to a binding: scroll input `[0, 1]` → hero
  scrub track output `[0, 8]` seconds, fallback `steps`.

## 2. The build script

`examples/simple-site/build-example.mjs` — the canonical pipeline script
(parse → registry → compose → generate → build). Walkthrough in
[04 — Building and exporting](04-building-and-export.md#a-complete-build-script);
the short version:

```js
import { parseConfig } from '@lumen/config';
import { createDefaultRegistry } from '@lumen/templates';
import { generate } from '@lumen/codegen';
import { build } from '@lumen/build';
import { manifestFromAssetRefs } from '@lumen/runtime';

const parsed = parseConfig(readFileSync('./engine.config.json', 'utf8'));
if (!parsed.ok) { /* print errors, exit 1 */ }
const config = parsed.config;

const registry = createDefaultRegistry();
const descriptor = registry.require(config.template);      // 'scroll-video'
const manifest = manifestFromAssetRefs(config.assets);     // minimal manifest from config
const scene = descriptor.compose(config, manifest);

const artifact = await build(
  { target: { ...config.build, target: 'static' }, outDir, onReport: console.log },
  (options) => generate(config, descriptor, scene, options),
);
```

## 3. Run it

```sh
node examples/simple-site/build-example.mjs
```

Expected console output (hashes vary with content):

```
config ok (migrations applied: 0)
composed: 2 root nodes, 2 tracks, 1 bindings
…build report (phases, file sizes, budget outcomes)…
entry: index.html
files: main.<hash>.js, index.html, hydration-manifest.<hash>.json
budgets passed: true
dist written to …/examples/simple-site/dist
```

Expected output tree:

```
examples/simple-site/dist/
├── index.html                      # SSR shell: theme CSS vars, <noscript>, lumen-root div
├── main.6241a3aadf.js              # boot module (SceneIR embedded + bootEngine call)
├── hydration-manifest.e133ca918e.json
└── manifest.json                   # deploy manifest: entry, files, sizes, hashes
```

## 4. What happens in the browser

Serve `dist/` over HTTP (`npx serve examples/simple-site/dist`) and open it:

1. `index.html` loads `main.<hash>.js` as a module. The module reads the
   embedded SceneIR (also inlined in a `<script id="lumen-scene-ir">` tag)
   and calls `bootEngine(root, ir)`, then
   `hydrateIslands(engine, ir.hydration.islands)` for the caption island.
2. `bootEngine` starts the **kernel** (created → booting → loading → ready →
   active). During `loading`, an asset-preload plugin fetches
   `preload: 'critical'` assets (the hero video).
3. A `<canvas>` surface is appended to the root element, a renderer backend
   is selected from device capabilities (WebGL2 preferred, Canvas2D
   fallback), and the interaction layer attaches to the root.
4. Each frame: the **virtual scroller** turns wheel/touch input into a
   smoothed, clamped scroll progress; the interaction layer maps bindings to
   a **driver map** (`trackId → seconds`); the scene layer merges those with
   time-driven playheads, evaluates keyframes, applies property bindings
   (`playback.time` for the video, `material.opacity` for the captions),
   updates world transforms, and the renderer draws the frame — with an
   adaptive quality controller lowering DPR if frames run over budget.

Net effect: scroll down → video scrubs forward; past 8 scroll units the
captions fade in, hold, and fade out by unit 12.

## 5. Variations

### Add a second caption

Add another scene to the `caption` slot. It gets its own scroll range after
the existing captions (units 12–16), its own fade track, and its own
hydration island — no other changes needed:

```jsonc
{
  "id": "captions-2",
  "slot": "caption",
  "nodes": [
    { "id": "caption-cta", "kind": "dom",
      "html": "<p><a href=\"https://example.com\">Get started</a></p>" }
  ],
  "track": { "driver": "scroll", "durationOrRange": 4 },
  "a11y": { "label": "Call to action", "summary": "Closing link." }
}
```

### Reduced motion

Set the interaction fallback to `'static'` (frozen frame) or keep `'steps'`
(discrete caption steps) — under `prefers-reduced-motion`, time-driven tracks
hold at their first frame and only user-driven tracks advance. You can also
force it at boot with `bootEngine(root, ir, { reducedMotion: true })`.

```jsonc
{ "id": "scroll-main", "source": "scroll", "scene": "hero",
  "inputRange": [0, 1], "a11yFallback": "static" }
```

### Embed as a Web Component

Change the build target and rebuild:

```js
const artifact = await build(
  { target: { ...config.build, target: 'webcomponent' }, outDir: 'dist/embed' },
  (options) => generate(config, descriptor, scene, options),
);
```

This emits `lumen-embed.<hash>.js`, which registers a `<lumen-embed>` custom
element. In the host page:

```html
<script type="module" src="/dist/embed/lumen-embed.<hash>.js"></script>
<lumen-embed></lumen-embed>
```

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `config error: version: expected version 3, got …` | Old or missing `version` | Set `"version": 3` — or let migrations run: versions 0–2 upgrade automatically; newer-than-3 configs are rejected. |
| `config error: scenes[0].nodes[0].assetId: references unknown asset` | Typo or missing `assets[]` entry | `assetId` must match an `assets[].id` exactly. |
| `config error: scenes[0].nodes[1].html: kind 'dom' requires html content` | `dom` node without `html` | Add the `html` string (or change `kind`). |
| `invalid JSON: …` at path `''` | Syntax error | JSONC comments are fine; trailing commas are not. |
| `template warning: … targets unknown slot '…'` | Slot id not in the template | Check the slot catalog in [../templates.md](../templates.md) (scroll-video: `stage`, `caption`). |
| Asset 404s in the browser | `src` URLs unreachable | The example uses placeholder remote URLs; point `src` at real hosted media. Lumen never copies media into `dist/`. |
| `build: size budgets failed (strictBudgets) — js-gz: … > …` | Output exceeds a budget | Remove weight (fewer capabilities, less inline HTML), or raise/adjust `budgets` in the build call. With `strictBudgets` off, the build succeeds and the failure is only in the report. |
| Blank page | Serving from `file://`, wrong base path, or JS error | Serve over HTTP; check the console — `bootEngine` throws without a DOM and the entry throws if `#lumen-root` is missing. |
| Video doesn't scrub | Binding mismatch | Ensure an interaction targets the stage scene (`"scene": "hero"`) and the stage scene's track driver is `scroll`. |

## Where next

- [02 — Custom templates](02-custom-templates.md) — when the four built-ins aren't enough.
- [../getting-started.md](../getting-started.md) — the condensed four-step version.
