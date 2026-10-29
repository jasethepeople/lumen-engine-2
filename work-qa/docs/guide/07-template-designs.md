# 07 — Template Designs: scroll-cinema-landing & cinematic-story

Two specialization descriptors shipped in `@lumen/templates`. `TemplateKind`
is frozen, so both reuse an existing kind and are distinguished by descriptor
id/version, slot set, and node-meta namespacing:

| Descriptor | `kind` | Descriptor id | Node meta key | Registered via |
| --- | --- | --- | --- | --- |
| `scrollCinemaLandingTemplate` | `scroll-video` | `scroll-cinema-landing` | `meta['scroll-cinema-landing']` | `createExtendedRegistry()` |
| `cinematicStoryTemplate` | `cinematic-spa` | `cinematic-story` | `meta['cinematic-story']` | `createExtendedRegistry()` |

Because the registry keys descriptors by kind, `createExtendedRegistry()`
returns the four built-ins with `scroll-video` and `cinematic-spa` **replaced**
by these specializations. `createDefaultRegistry()` is unchanged.

```ts
import { createExtendedRegistry } from '@lumen/templates';
const registry = createExtendedRegistry();
registry.require('scroll-video');   // → scrollCinemaLandingTemplate
registry.require('cinematic-spa');  // → cinematicStoryTemplate
```

---

## 1. `scroll-cinema-landing` — premium scroll-scrubbed landing page

### (a) Config schema

| Slot | Scenes | Accepts | Reads from config | Defaults |
| --- | --- | --- | --- | --- |
| `stage` | exactly 1 | `video-plane` | `nodes[0].assetId` (falls back to first `video` in manifest), `track.durationOrRange` = **total scroll extent** | — |
| `logo` | 0–1 | `dom` | `nodes[*].html` | static, always visible |
| `hero-caption` | 0–1 | `dom` | `nodes[*].html` | fades out over first **15%** of scroll (`HERO_CAPTION_FADE_FRACTION`) |
| `chapters` | 0–6 | `dom`, `sprite` | `nodes[*].html`; optional `nodes[0].meta.scrollRange: [start, end]` override | equal slices of the middle scroll region (15%..88%) |
| `outro` | 0–1 | `dom` | `nodes[*].html` | fades in over last **12%** of scroll (`OUTRO_FADE_FRACTION`) |

Every scene still needs `id`, `slot`, `nodes`, `track.driver: 'scroll'`, and
`a11y.label`. Interactions: a `source: 'scroll'` binding whose `scene` is the
stage scene id drives scrub + parallax.

Theme tokens: `SCROLL_CINEMA_LANDING_THEME_DEFAULTS` — colors `background
#050507`, `foreground #f4f2ec`, `accent #c9a86a`, `caption-bg`, `chapter-bg`;
shared type scale/spacing; motion durations `fast 180 / medium 400 / slow 800`.
Budgets: `jsGzBytes 120k`, `criticalAssetBytes 1.8M`, `firstFrameMs 1500`.
Capabilities: renderers `webgl2 + canvas2d`, asset feature `hls`, interactions
`scroll + touch`.

### (b) Mapping: config → scene

- **Stage scene → video plane + two tracks.** One `video-plane` node
  (`node-<sceneId>-video`, payload `{ assetId, scrubbed: true }`). A **scrub
  track** (`track-<id>-scrub`, driver `scroll`, range `[0, totalRange]`,
  keyframes `0 → videoDuration` linear, from the manifest's video duration) is
  bound to `playback.time`. A **parallax track** (`track-<id>-parallax`,
  keyframes `1.0 → 1.08` linear — `PARALLAX_SCALE`) is bound to
  `transform.scale`, producing the subtle zoom over full scroll.
- **Hero caption → opacity track** on a `group` node: keyframes `1 → 0` over
  `[0, totalRange * 0.15]`, bound to `material.opacity`.
- **Chapters → fade-in/hold/fade-out windows.** Each chapter gets a 4-keyframe
  track (`0 → 1 → 1 → 0`, 12% lead-in/lead-out of its window, ease-out/ease-in)
  over either its explicit `meta.scrollRange` or its default equal slice.
- **Outro → opacity track** `0 → 1` over `[totalRange * 0.88, totalRange]`.
- **Logo → static DOM group**, no track; its children are authored without
  bindings.
- **Assets → manifest**: the stage `assetId` resolves via
  `manifestEntry(...)` with `firstAssetOfKind(manifest, 'video')` fallback; the
  manifest video `duration` sets the scrub endpoint.
- **Layout/theme**: layers — video `0`, chapters `10`, hero/outro `20`, logo
  `30`; theme tokens resolve through `resolveThemeTokens` and are emitted as
  `--lumen-*` CSS variables in the critical CSS (see below).

### (c) Full example config

`examples/scroll-cinema-landing/engine.config.json` (JSONC, annotated inline):

```jsonc
{
  "version": 3,
  "id": "scroll-cinema-landing",
  "template": "scroll-video",          // kind; extended registry maps it to scroll-cinema-landing
  "meta": { "title": "Aurora — Scroll Cinema", "description": "...", "locale": "en" },
  "theme": { "colors": { "background": "#050507", "foreground": "#f4f2ec", "accent": "#c9a86a" } },
  "assets": [
    { "id": "cinema-video",  "src": "https://media.example.com/lumen/aurora.mp4",        "kind": "video", "preload": "critical" },
    { "id": "cinema-poster", "src": "https://media.example.com/lumen/aurora-poster.jpg", "kind": "image", "preload": "eager" }
  ],
  "scenes": [
    { "id": "stage",        "slot": "stage",        "track": { "driver": "scroll", "durationOrRange": 10 },
      "nodes": [{ "id": "stage-video", "kind": "video-plane", "assetId": "cinema-video" }],
      "a11y": { "label": "Aurora background film", "summary": "An aurora borealis timelapse scrubbed by page scroll." } },
    { "id": "brand",        "slot": "logo",         "track": { "driver": "scroll", "durationOrRange": 10 },
      "nodes": [{ "id": "brand-mark", "kind": "dom", "html": "<span class=\"logo\">AURORA</span>" }],
      "a11y": { "label": "Brand logo" } },
    { "id": "hero-caption", "slot": "hero-caption", "track": { "driver": "scroll", "durationOrRange": 10 },
      "nodes": [{ "id": "hero-title", "kind": "dom", "html": "<h1>Light, in motion.</h1><p>Scroll to begin.</p>" }],
      "a11y": { "label": "Hero caption" } },
    { "id": "chapter-1",    "slot": "chapters",     "track": { "driver": "scroll", "durationOrRange": 2 },
      "nodes": [{ "id": "chapter-1-text", "kind": "dom", "html": "<h2>Chapter I</h2><p>The sky ignites.</p>" }],
      "a11y": { "label": "Chapter one" } },
    { "id": "chapter-2",    "slot": "chapters",     "track": { "driver": "scroll", "durationOrRange": 2 },
      "nodes": [{ "id": "chapter-2-text", "kind": "dom", "html": "<h2>Chapter II</h2><p>Colour becomes weather.</p>" }],
      "a11y": { "label": "Chapter two" } },
    { "id": "chapter-3",    "slot": "chapters",     "track": { "driver": "scroll", "durationOrRange": 2 },
      "nodes": [{ "id": "chapter-3-text", "kind": "dom", "html": "<h2>Chapter III</h2><p>Silence, then dawn.</p>",
                  "meta": { "scrollRange": [6.2, 8.2] } }],   // explicit window override
      "a11y": { "label": "Chapter three" } },
    { "id": "outro",        "slot": "outro",        "track": { "driver": "scroll", "durationOrRange": 10 },
      "nodes": [{ "id": "outro-cta", "kind": "dom", "html": "<h2>Aurora</h2><p>Available worldwide.</p>" }],
      "a11y": { "label": "Outro call to action" } }
  ],
  "interactions": [
    { "id": "scroll-scrub", "source": "scroll", "scene": "stage",
      "inputRange": [0, 1], "a11yFallback": "native-video" }
  ],
  "build": { "target": "static", "ssr": true, "minify": false }
}
```

### (d) Generated output walkthrough

`node examples/scroll-cinema-landing/build-example.mjs` produces
(`budgets passed: true`):

```
examples/scroll-cinema-landing/dist/
  index.html                            # SSR shell + critical CSS + scene IR
  main.ba547c0c56.js                    # hashed entry (boot + hydrate)
  hydration-manifest.e3d8b87782.json    # island list
  manifest.json                         # asset manifest
```

`index.html` critical CSS inlines the resolved theme tokens as CSS variables:

```html
<style>
  :root {
    --lumen-color-background: #050507;
    --lumen-color-foreground: #f4f2ec;
    --lumen-color-accent: #c9a86a;
    --lumen-color-caption-bg: rgba(5, 5, 7, 0.45);
    --lumen-color-chapter-bg: rgba(5, 5, 7, 0.6);
    --lumen-type-display-size: 3rem;
    --lumen-duration-fast: 150ms;  /* … spacing, easing, … */
    --lumen-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  }
  .lumen-scene{position:relative} /* … */
</style>
```

The SSR skeleton renders every slot's DOM content into the stage section
(spatial video placeholder + overlay groups), with a11y labels and a
`noscript` fallback:

```html
<main class="lumen-root" id="lumen-root" data-site="scroll-cinema-landing">
  <section id="stage" class="lumen-scene" data-slot="stage" aria-label="Aurora background film">
    <div class="lumen-spatial" data-node="node-stage-video" data-asset="cinema-video" role="img" …></div>
    <section class="lumen-scene" data-node="node-hero-caption">…</section>
    <section class="lumen-scene" data-node="node-chapter-1">…</section>
    …
  </section>
```

`main.<hash>.js` boots from an embedded (or inlined-`<script>`) scene IR:

```js
import { bootEngine, hydrateIslands } from '@lumen/runtime';
const SCENE_IR = {"version":1,"site":{…},"template":"scroll-video","theme":{…},"nodes":[…],"tracks":[…],…};
const irTag = document.getElementById('lumen-scene-ir');
const ir = irTag ? JSON.parse(irTag.textContent ?? 'null') ?? SCENE_IR : SCENE_IR;
async function main() {
  const engine = await bootEngine(document.getElementById('lumen-root'), ir);
  await hydrateIslands(engine, ir.hydration.islands); // logo, hero, chapters, outro
}
void main();
```

### (e) Customization knobs

- `theme` overrides (colors/type/spacing/motion) merge per key.
- `HERO_CAPTION_FADE_FRACTION`, `OUTRO_FADE_FRACTION`, `PARALLAX_SCALE`
  constants — import and re-derive, or fork the descriptor.
- Per-chapter `meta.scrollRange: [start, end]` for editorial timing control.
- `track.durationOrRange` on the stage scene sets the total scroll length.
- `a11yFallback: 'native-video'` gives reduced-input users a native player.

---

## 2. `cinematic-story` — single-page cinematic storytelling

### (a) Config schema

| Slot | Scenes | Accepts | Reads from config | Defaults |
| --- | --- | --- | --- | --- |
| `title-card` | 0–1 | `dom` | `track.durationOrRange` | `TITLE_CARD_DURATION_S = 3`s |
| `acts` | 2–8 | `dom`, `sprite`, `mesh`, `video-plane` | `track.durationOrRange`; per-act `nodes[*].meta.durationHint` (s) override | 6s if neither set |
| `score` | 0–1 | `dom` | `nodes[0].meta.assetId` → audio manifest entry (fallback: first `audio` asset) | autoplay, no loop |
| `credits` | 0–1 | `dom` | `track.durationOrRange` | 4s |

All tracks are `driver: 'time'`. Interactions: `source: 'keyboard'` bindings
targeting act scenes resolve onto the act tracks. **Navigation contract:** the
runtime maps `onNavigate` to the `scene:next` / `scene:prev` event-bus topics;
the declarative keyboard bindings are the config-level edge of that contract.

Theme tokens: `CINEMATIC_STORY_THEME_DEFAULTS` — colors `background #08080c`,
`foreground #efece4`, `accent #b0874f`, `surface`, `caption-bg`; motion
durations `fast 200 / medium 500 / slow 1200`. Budgets: `jsGzBytes 160k`,
`criticalAssetBytes 2M`, `firstFrameMs 2000`. Capabilities: renderers
`webgl2 + dom`, asset feature `hls`, interactions `keyboard + pointer + scroll`.

### (b) Mapping: config → scene

- **Sequencing → time clock.** Title card starts at `t=0`. Each subsequent
  scene starts at `previousEnd - CROSSFADE_S` (1.2s overlap), so consecutive
  scenes crossfade. Act durations come from `meta.durationHint` first, then
  `track.durationOrRange`.
- **Transitions → keyframed opacity tracks.** Every sequenced scene gets a
  4-keyframe track on `material.opacity`: `0 → 1` over the first 1.2s, hold,
  `1 → 0` over the last 1.2s. This crossfade pattern is this template's
  transition model (vs. cinematic-spa's 20%-of-duration fades).
- **Reduced motion → instant cuts.** All crossfade keyframes use
  `easing: 'linear'`, and every sequenced group carries
  `meta['cinematic-story'].reducedMotion = { transition: 'cut', easing: 'linear' }`;
  the runtime snaps values instead of interpolating when the user's
  `prefers-reduced-motion` is set (kernel `capabilities.reducedMotion`).
- **Score → DOM carrier node** with `meta['cinematic-story'].assetId` resolved
  against the manifest (`audio` kind), `autoplay: true`, and
  `totalDuration` set to the sequence clock length.
- **Missing media assets** are kept but flagged with
  `meta['cinematic-story'].missingAsset: true` for build-time warnings.
- **Layout/theme**: layers — acts `5`, title-card/credits `10`; DOM-bearing
  scenes become hydration islands; theme tokens emit as `--lumen-*` vars.

### (c) Full example config

`examples/cinematic-story/engine.config.json` (JSONC, annotated inline):

```jsonc
{
  "version": 3,
  "id": "cinematic-story",
  "template": "cinematic-spa",        // kind; extended registry maps it to cinematic-story
  "meta": { "title": "The Long Way North", "description": "...", "locale": "en" },
  "theme": { "colors": { "background": "#08080c", "foreground": "#efece4", "accent": "#b0874f" } },
  "assets": [
    { "id": "act-one-film",   "src": "https://media.example.com/lumen/north-act1.mp4",  "kind": "video", "preload": "critical" },
    { "id": "story-score",    "src": "https://media.example.com/lumen/north-score.mp3", "kind": "audio", "preload": "eager" },
    { "id": "act-three-still","src": "https://media.example.com/lumen/north-act3.jpg",  "kind": "image", "preload": "lazy" }
  ],
  "scenes": [
    { "id": "title-card", "slot": "title-card", "track": { "driver": "time", "durationOrRange": 3 },
      "nodes": [{ "id": "title-text", "kind": "dom", "html": "<h1>The Long Way North</h1><p>A story in three acts</p>" }],
      "a11y": { "label": "Title card" } },
    { "id": "act-1", "slot": "acts", "track": { "driver": "time", "durationOrRange": 6 },
      "nodes": [
        { "id": "act-1-video",   "kind": "video-plane", "assetId": "act-one-film" },
        { "id": "act-1-caption", "kind": "dom", "html": "<h2>I. Departure</h2><p>The road unspools behind.</p>" }
      ],
      "a11y": { "label": "Act one: departure" } },
    { "id": "act-2", "slot": "acts", "track": { "driver": "time", "durationOrRange": 5 },
      "nodes": [{ "id": "act-2-caption", "kind": "dom",
                  "html": "<h2>II. Weather</h2><p>The storm decides the pace.</p>",
                  "meta": { "durationHint": 8 } }],       // 8s overrides track duration
      "a11y": { "label": "Act two: weather" } },
    { "id": "act-3", "slot": "acts", "track": { "driver": "time", "durationOrRange": 6 },
      "nodes": [
        { "id": "act-3-still",   "kind": "sprite", "assetId": "act-three-still" },
        { "id": "act-3-caption", "kind": "dom", "html": "<h2>III. Arrival</h2><p>North is a feeling, not a place.</p>" }
      ],
      "a11y": { "label": "Act three: arrival" } },
    { "id": "score", "slot": "score", "track": { "driver": "time", "durationOrRange": 0 },
      "nodes": [{ "id": "score-carrier", "kind": "dom", "html": "", "meta": { "assetId": "story-score" } }],
      "a11y": { "label": "Musical score" } },
    { "id": "credits", "slot": "credits", "track": { "driver": "time", "durationOrRange": 4 },
      "nodes": [{ "id": "credits-roll", "kind": "dom", "html": "<p>Directed by Lumen · Shot on location</p>" }],
      "a11y": { "label": "Credits" } }
  ],
  "interactions": [
    // Keyboard arrows → runtime onNavigate → 'scene:next' / 'scene:prev' bus events.
    { "id": "kbd-next", "source": "keyboard", "scene": "act-1", "inputRange": [0, 1], "a11yFallback": "steps" },
    { "id": "kbd-prev", "source": "keyboard", "scene": "act-2", "inputRange": [0, 1], "a11yFallback": "steps" }
  ],
  "build": { "target": "static", "ssr": true, "minify": false }
}
```

### (d) Generated output walkthrough

`node examples/cinematic-story/build-example.mjs` produces
(`budgets passed: true`):

```
examples/cinematic-story/dist/
  index.html
  main.326b2be799.js
  hydration-manifest.a4240762d1.json
  manifest.json
```

`index.html` carries the same critical-CSS pattern (`:root { --lumen-color-*
… }`), an SSR skeleton with one `data-slot` section per scene (`title-card`,
three `acts`, `score`, `credits`), `aria-label`s from `a11y.label`, and a
`noscript` fallback. The embedded scene IR lists the time tracks with their
crossfade windows and the hydration islands:

```js
"hydration":{"ssr":true,"islands":["node-title-card","node-act-1","node-act-2","node-act-3","node-credits"]}
```

`main.<hash>.js` boot structure is identical in shape to the landing example
above: import `bootEngine`/`hydrateIslands`, read `#lumen-scene-ir` (falling
back to the embedded `SCENE_IR`), boot, hydrate islands.

### (e) Customization knobs

- `TITLE_CARD_DURATION_S` / `CROSSFADE_S` constants; per-act
  `meta.durationHint`.
- `theme` overrides merge per key (e.g. slower `motion.duration.slow`).
- Score behavior flags in `meta['cinematic-story']` (`autoplay`, `loop`) are
  carried for the runtime; omit the `score` slot for a silent cut.
- Reduced-motion handling is automatic via the `reducedMotion` meta flag +
  linear easings; no config switch needed.
- Fork the descriptor and re-`register()` it in your own registry for deeper
  changes (see [02 — Custom templates](02-custom-templates.md)).
