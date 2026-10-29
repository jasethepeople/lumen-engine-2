# 03 — Writing Configs

Everything you author in Lumen lives in one `EngineConfig` — usually a
`lumen.config.jsonc` file (JSON with comments; `parseConfig` strips `//` and
`/* */` comments before parsing). This guide covers every field exactly as
defined in `contracts/src/config.ts` and validated by
`packages/config/src/schema.ts`.

## The full skeleton

```jsonc
{
  "version": 3,                    // required: config schema version (exactly 3)
  "id": "my-site",                 // required: unique site/engine id
  "template": "scroll-video",      // required: scroll-video | cinematic-spa | viewer-3d | storytelling

  "meta": {                        // required: site metadata
    "title": "My Site",            //   required, non-empty
    "description": "…",            //   required (may be empty string)
    "locale": "en",                //   required, non-empty
    "ogImage": "https://…/og.jpg"  //   optional
  },

  "theme": {                       // required object; every token group optional
    "colors": { "accent": "#8ab4ff" },        // CSS colors: hex, rgb(), hsl(), var(--x), named
    "typeScale": {                            // step name → { size, lineHeight, weight }
      "display": { "size": "3rem", "lineHeight": 1.1, "weight": 700 }
    },
    "spacing": { "md": "1rem" },              // name → CSS length
    "motion": {
      "standard": [0.4, 0, 0.2, 1],           // cubic-bezier; x components must be 0–1
      "emphasized": [0.2, 0, 0, 1],
      "duration": { "fast": 150 }             // name → milliseconds
    }
  },

  "assets": [                      // required array (may be empty)
    {
      "id": "hero-video",          //   required, unique across assets
      "src": "./media/hero.mp4",   //   required: local path or URL
      "kind": "video",             //   required: image | video | model | font | lottie | audio
      "profile": "web-hd",         //   optional: named transcode profile (build-defined)
      "preload": "critical"        //   optional: critical | eager | lazy (defaulted per kind)
    }
  ],

  "scenes": [                      // required array (may be empty)
    {
      "id": "hero",                //   required, unique across scenes
      "slot": "stage",             //   required: a slot id of the selected template
      "nodes": [                   //   required array
        {
          "id": "hero-plane",      //     required, unique within the config
          "kind": "video-plane",   //     required: group | mesh | video-plane | dom | camera | light | sprite
          "assetId": "hero-video", //     required for mesh / video-plane / sprite; must reference assets[].id
          "html": "<h1>Hi</h1>",   //     required for dom nodes; HTML fragment string
          "meta": { "…": "…" }     //     optional free-form metadata
        }
      ],
      "track": {                   //   required: timeline driver + extent
        "driver": "scroll",        //     time | scroll | pointer | playback
        "durationOrRange": 8       //     seconds (time/playback) or scroll units (scroll/pointer); ≥ 0
      },
      "a11y": {                    //   required accessibility metadata
        "label": "Hero video",     //     required, non-empty
        "summary": "Slow pan…"     //     optional
      }
    }
  ],

  "interactions": [                // required array (may be empty)
    {
      "id": "scroll-main",         //   required, unique across interactions
      "source": "scroll",          //   required: scroll | pointer | touch | keyboard | deviceorientation
      "gesture": "pan",            //   optional: pan | pinch | swipe | tap | longpress
      "scene": "hero",             //   required: must reference scenes[].id
      "inputRange": [0, 1],        //   required: [min, max] input domain (px, radians, or unit deltas)
      "a11yFallback": "steps"      //   optional: steps | static | native-video
    }
  ],

  "build": {                       // required: codegen/build target
    "target": "static",            //   required: static | webcomponent | npm | runtime
    "minify": true,                //   optional (default true)
    "ssr": true,                   //   optional (default true)
    "moduleFormat": "esm"          //   optional: esm | cjs | iife (default esm)
  }
}
```

## Field notes

### version / id / template

- `version` must be the literal `3`. Older documents are upgraded by the
  migration registry before validation (see "Migrations" below).
- `id` identifies the site; codegen uses it for generated names (e.g. the
  `npm` target derives a factory name like `createMySiteEngine`).
- `template` selects the `TemplateDescriptor` from the registry. Slots,
  budgets, and capabilities come from that descriptor — see
  [../templates.md](../templates.md) for each template's slot catalog.

### scenes

A scene is a section of your site mapped into a **template slot**. Three
things matter:

1. **`slot` placement.** Which slot ids exist and which node kinds they
   accept is defined by the template (e.g. `scroll-video` has `stage`
   accepting `video-plane`, and `caption` accepting `dom`/`sprite`). Wrong
   slots/kinds produce registry **warnings**, not parse errors.
2. **Nodes** are declarative: you give `kind` + `assetId` (for
   mesh/video-plane/sprite) or `html` (for dom). You do **not** write
   transforms, keyframes, or bindings in config — the template's `compose()`
   generates those. Config nodes map to scene-graph nodes via the template.
3. **`track`** declares how the scene's timeline advances:
   - `time` — plays over `durationOrRange` seconds, driven by the frame clock.
   - `scroll` — the playhead is the (virtual) scroll position;
     `durationOrRange` is the scene's extent in scroll units.
   - `pointer` — driven by pointer/drag input.
   - `playback` — free media playback over `durationOrRange` seconds.

### interactions

An interaction maps an input source onto a scene's track. At composition
time the template resolves `scene` → concrete `targetNodeId` /
`targetTrackId` and builds the domain mapping: your `inputRange` becomes the
input domain and `[0, scene.track.durationOrRange]` becomes the timeline
output range. `a11yFallback` (default `'static'` when omitted) decides how
the binding degrades under `prefers-reduced-motion` or assistive tech:
`'steps'` (discrete steps), `'static'` (frozen frame), or `'native-video'`
(hand playback back to a native `<video>` element).

### "Transitions" and "layout" — how they actually work

There are **no `transitions` or `layout` fields** in `EngineConfig`. Both
are expressed through the existing mechanisms:

- **Entrance/exit transitions** come from the keyframed tracks the template
  generates per scene. For example, `scroll-video` gives each caption scene a
  scroll-driven fade track over its scroll range
  (`[offset, offset + durationOrRange]`) with keyframes at 0/15%/85%/100% —
  a fade-in, hold, fade-out. To change transition feel, adjust a scene's
  `durationOrRange` (longer range = slower fade) or the template's keyframe
  pattern ([02 — Custom templates](02-custom-templates.md)).
- **Scene sequencing** for scroll templates is implicit: scenes stack in
  config order, each occupying its own scroll range (offset = sum of previous
  scenes' `durationOrRange`).
- **Layout** is the scene graph: each node has a local `Transform`
  (`position`, `rotationQuat`, `scale`) composed by `compose()`; DOM regions
  are styled with theme tokens emitted as CSS custom properties
  (`--lumen-color-*`, `--lumen-type-*`, `--lumen-space-*`,
  `--lumen-duration-*`, `--lumen-ease-*`). Slots declare `region`
  (`dom`/`spatial`/`hybrid`) to say where their content renders.

### Behaviors and reduced motion

- **Time-driven** tracks advance with the frame clock; **scroll/pointer**
  tracks are driven by the interaction layer (virtual scroller for scroll,
  gesture recognizers for pointer). You select the behavior per scene via
  `track.driver` plus the matching `interactions` entry.
- Under `prefers-reduced-motion` (or `bootEngine`'s `reducedMotion` option),
  **time-driven tracks hold at their first frame**; only user-driven
  (scroll/pointer) tracks keep advancing, and each binding degrades per its
  `a11yFallback`.

## What applyDefaults() fills in

After validation, `applyDefaults()` deep-merges defaults **under** your
values (authored values always win; arrays are replaced, not concatenated):

| Where                       | Default |
| --------------------------- | ------- |
| `build.minify`              | `true` |
| `build.ssr`                 | `true` |
| `build.moduleFormat`        | `'esm'` |
| `assets[].preload` (unset)  | Per kind: `image` → `lazy`, `video` → `eager`, `model` → `eager`, `font` → `critical`, `lottie` → `lazy`, `audio` → `lazy` |
| `theme` (baseline under yours) | `colors`: `color-bg` `#0b0d10`, `color-fg` `#f5f7fa`, `color-accent` `#6aa9ff`, `color-muted` `#8b93a1`; `typeScale`: `body` (1rem/1.5/400), `display` (3rem/1.1/700); `spacing`: `xs` 0.25rem → `xl` 4rem; `motion`: `standard` `[0.2,0,0,1]`, `emphasized` `[0.3,0,0,1]`, `duration.fast` 150 |

Note the baseline theme keys carry a `color-` prefix (`color-bg`, …). The
CSS variable convention adds `--lumen-color-` in front of the key, so
baseline keys emit as `--lumen-color-color-bg` — a known, harmless cosmetic
quirk (see [../refactor-changelog.md](../refactor-changelog.md)). Prefer
plain key names in your own configs (`background`, `accent`).

> Two merge layers exist. At parse time, `applyDefaults` merges the baseline
> tokens in the table above **under** your `config.theme`. At compose time,
> the selected template resolves the final tokens as
> `resolveThemeTokens(templateDefaults, config.theme)` — so your config
> (including the baseline it absorbed) wins per-key over the template's
> `themeTokens` defaults.

## Validation errors

`parseConfig()` never throws for bad configs — it returns
`{ ok: false, errors, appliedMigrations }`. Each error is
`{ path, message }` with a JSON path; **all** problems are reported at once:

```ts
import { parseConfig } from '@lumen/config';
import { readFileSync } from 'node:fs';

const parsed = parseConfig(readFileSync('./lumen.config.jsonc', 'utf8'));
if (!parsed.ok) {
  for (const e of parsed.errors) console.error(`${e.path}: ${e.message}`);
  process.exit(1);
}
parsed.config;            // EngineConfig, defaults applied
parsed.appliedMigrations; // e.g. ['0→1', '1→2']
```

Example output for a broken config:

```
version: expected version 3, got 2 (run migrations first)
scenes[0].nodes[0].assetId: references unknown asset "hero-vidoe"
scenes[0].nodes[1].html: kind 'dom' requires html content
interactions[0].scene: references unknown scene "intro"
assets[1].id: duplicate assets id "hero-video"
```

Cross-field checks beyond per-field types: unique ids for
assets/scenes/interactions, `interactions[].scene` must reference an
existing scene, `assetId` must reference an existing asset (and is required
for `mesh`/`video-plane`/`sprite`), and `html` is required for `dom` nodes.

## Migrations

Configs older than `version: 3` are upgraded automatically by a linear
migration registry before validation (`migrate → validate → defaults`):

| Step    | What it does |
| ------- | ------------ |
| `0→1`   | Pre-versioned configs: renames `site` → `id`, seeds empty `interactions`/`assets`. |
| `1→2`   | Renames scene `timeline: { mode, length }` → `track: { driver, durationOrRange }`. |
| `2→3`   | Renames `output` → `build` and legacy target names (`static-site` → `static`, `web-component` → `webcomponent`, `npm-lib` → `npm`, `runtime-json` → `runtime`). |

Applied steps are reported in `appliedMigrations`. A config with a version
**newer** than 3 fails with a single error at path `''`.

## Next steps

- [04 — Building and exporting](04-building-and-export.md) — turn the config into `dist/`.
- [05 — Worked example: scroll-video](05-example-scroll-video.md) — a complete config annotated block by block.
