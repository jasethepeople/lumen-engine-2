# Getting Started

From zero to a built Lumen site in four steps: write an `EngineConfig`, pick
a template, run codegen + build, serve the output.

## 0. Prerequisites

- Node.js ≥ 18 (the build pipeline uses `node:fs` / `node:crypto` / `node:zlib`).
- From the repo root:

```sh
npm install     # npm workspaces: contracts/ + packages/*
npm run build   # bash scripts/build-all.sh: contracts first, then packages in
                # dependency order, then @lumen/runtime + root entry, then
                # scripts/link-workspaces.mjs workspace shims
```

Every package follows the unified build convention (SPEC rule 3a): a single
`tsconfig.json` per package (`rootDir: "src"`, flat `dist/`, contracts
resolved against `contracts/dist`) and uniform `package.json` entries
(`main`/`types`/`exports` → `./dist/index.*`). Regenerate the checked-in
example output with `npm run example`
(`node examples/simple-site/build-example.mjs`).

## 1. Write an EngineConfig

Create `lumen.config.jsonc` (JSON with comments is fine — `parseConfig`
strips them):

```jsonc
{
  "version": 3,
  "id": "my-site",
  "template": "scroll-video",
  "meta": {
    "title": "My Site",
    "description": "A scroll-driven video experience.",
    "locale": "en"
  },
  "theme": {
    "colors": { "bg": "#0b0b0f", "fg": "#f5f5f7" }
  },
  "assets": [
    { "id": "hero-video", "src": "./media/hero.mp4", "kind": "video", "preload": "critical" }
  ],
  "scenes": [
    {
      "id": "hero",
      "slot": "stage",
      "nodes": [
        { "id": "hero-plane", "kind": "video-plane", "assetId": "hero-video" }
      ],
      "track": { "driver": "scroll", "durationOrRange": 12 },
      "a11y": { "label": "Hero", "summary": "Product film scrubbed by scrolling." }
    }
  ],
  "interactions": [
    {
      "id": "scroll-hero",
      "source": "scroll",
      "scene": "hero",
      "inputRange": [0, 1],
      "a11yFallback": "steps"
    }
  ],
  "build": { "target": "static", "ssr": true, "minify": true }
}
```

### Config fields, briefly

| Field          | Meaning |
| -------------- | ------- |
| `version`      | Config schema version. Current is `3`; older versions are upgraded by the migration registry (`migrate → validate → defaults`). |
| `id`           | Unique site/engine id. Used in generated factory names (e.g. the `npm` target emits `createMySiteEngine`). |
| `template`     | One of the four `TemplateKind`s: `scroll-video`, `cinematic-spa`, `viewer-3d`, `storytelling`. See [templates.md](templates.md). |
| `meta`         | Site metadata: `title`, `description`, `locale`, optional `ogImage`. Drives SEO meta in the `static` target. |
| `theme`        | Partial `ThemeTokens` overrides (colors, type scale, spacing, motion), deep-merged over the template defaults at compose time. Token keys are plain names (`bg`, `accent`); emission adds the prefixes — CSS variables come out as `--lumen-color-bg`, `--lumen-space-*`, `--lumen-duration-*`, … (the single `--lumen-*` convention owned by `@lumen/templates`). |
| `assets`       | `AssetRef[]`: `id`, `src` (path/URL), `kind` (image/video/model/font/lottie/audio), optional `profile` and `preload` priority (`critical`/`eager`/`lazy`). |
| `scenes`       | `SceneConfig[]`: each scene targets a template `slot`, declares declarative `nodes` (`kind`: group/mesh/video-plane/dom/camera/light/sprite, with `assetId` or `html`), a `track` (`driver`: time/scroll/pointer/playback, plus `durationOrRange`), and `a11y` metadata. |
| `interactions` | `InteractionConfig[]`: bind an input `source` (scroll/pointer/gesture/keyboard…) to a scene track, with `inputRange`, optional `gesture` subtype, and an `a11yFallback` (`steps` / `static` / `native-video`). |
| `build`        | `CodegenTarget`: `target` (`static` / `webcomponent` / `npm` / `runtime`) plus `minify`, `ssr`, `moduleFormat` flags. |

Validation reports **every** problem with JSON paths:

```ts
import { parseConfig } from '@lumen/config';
import { readFileSync } from 'node:fs';

const parsed = parseConfig(readFileSync('./lumen.config.jsonc', 'utf8'));
if (!parsed.ok) {
  for (const e of parsed.errors) console.error(e.path, e.message);
  process.exit(1);
}
parsed.config;            // typed EngineConfig, defaults applied
parsed.appliedMigrations; // e.g. ['1→2', '2→3']
```

## 2. Pick a template and compose

Templates ship in `@lumen/templates`; the default registry has all four:

```ts
import { createDefaultRegistry } from '@lumen/templates';

const registry = createDefaultRegistry();
const template = registry.get(parsed.config.template); // TemplateDescriptor
```

Compose the config into a `ComposedScene` against your asset manifest (the
manifest pairs logical asset ids with built, content-hashed URLs; an empty
manifest is fine for a first pass):

```ts
const manifest = { version: 1, generatedAt: new Date().toISOString(), assets: {} }; // AssetManifest
const scene = template.compose(parsed.config, manifest);
```

## 3. Codegen + build

`@lumen/build` never imports codegen — you inject `generate`:

```ts
import { generate } from '@lumen/codegen';
import { build } from '@lumen/build';

const artifact = await build(
  {
    target: parsed.config.build, // from the config's `build` field
    outDir: 'dist/site',
    strictBudgets: process.env.CI === 'true',
    onReport: (text) => console.log(text),
  },
  (options) => generate(parsed.config, template, scene, options),
);

console.log(artifact.entry);           // hashed entry filename
console.log(artifact.budgets.passed);  // size budget outcome
```

The pipeline runs validate → generate → optimize → hash → emit → report and
writes content-hashed files plus a `manifest.json` deploy manifest into
`dist/site`.

## 4. Serve the output

Any static file server works:

```sh
npx serve dist/site        # or: python3 -m http.server -d dist/site
```

Open the printed URL. The generated boot module hydrates the embedded
`SceneIR`, boots the kernel, preloads `critical` assets, selects the best
renderer backend, and starts the frame loop.

## Next steps

- [guide/README.md](guide/README.md) — the in-depth developer guide (overview, configs, templates, building, worked example).
- [templates.md](templates.md) — choose the right template and its slots.
- [extending.md](extending.md) — add plugins, custom templates, custom renderers.
- [api-index.md](api-index.md) — key exported symbols per package.
