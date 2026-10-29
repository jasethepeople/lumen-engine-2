# @lumen/codegen

Code generation layer for the Lumen engine: transforms a validated
`EngineConfig` plus the `ComposedScene` produced by a `TemplateDescriptor`
into per-target entry modules, a hydration manifest, type declarations, and
(optionally) an SSR HTML shell.

Strict TypeScript, ESM, **zero runtime dependencies**. Emission is done with a
small string/AST-lite toolkit (indented writer + import manager), not
`ts-morph`, so the package stays dependency-free and Node + browser safe.

## Responsibilities

- Lower config + composed scene into a serializable **SceneIR** JSON document.
- Emit per-target entry points:
  - `static` — `index.html` (semantic markup, SEO meta from `config.meta`,
    inline critical CSS compiled from theme tokens, `<noscript>` fallback, SSR
    skeleton of the first scene) + a `main` module that embeds the SceneIR and
    boots `@lumen/runtime`.
  - `webcomponent` — self-contained `<lumen-embed>` custom element with shadow
    DOM; embedded SceneIR by default, overridable via the `config-url`
    attribute.
  - `runtime` — minimal loader that fetches SceneIR/config JSON by URL
    (auto-boots from `<script data-config-url="...">`).
  - `npm` — package entry re-exporting the runtime API plus a preconfigured
    `create<SiteId>Engine(root)` factory with the SceneIR baked in.
- Collect non-fatal warnings: `missing-asset`, `unused-asset`,
  `oversized-inline-json` (> 150 KB embedded IR), `a11y-missing-summary`,
  `a11y-missing-fallback`.
- Produce a `hydration-manifest.json` (islands: id, module, trigger, props)
  and a flattened `importGraph` for the build agent's bundle analysis.

## IR design

`SceneIR` (see `src/ir.ts`) is a versioned, JSON-serializable snapshot:
site metadata, template kind, fully-resolved `ThemeTokens` (descriptor
defaults merged with `config.theme` overrides), the scene-node forest (dom /
video-plane / mesh payloads flattened to `assetId` / `html` / `scrubbed`
fields), timeline tracks, resolved interaction bindings, runtime asset refs,
hydration hints, and per-scene a11y metadata. Generated modules embed it as a
single `const SCENE_IR = {...}` literal (all HTML-breaking characters escaped)
and `@lumen/runtime` hydrates the live scene graph from it at boot. The IR is
deliberately *not* `as const` so the literal stays assignable to mutable
runtime parameters.

## Usage

```ts
import { generate } from '@lumen/codegen';
import { validateConfig } from '@lumen/config';
import { scrollVideoTemplate } from '@lumen/templates'; // TemplateDescriptor

const config = validateConfig(rawConfig);
const scene = scrollVideoTemplate.compose(config, assetManifest);

const result = generate(config, scrollVideoTemplate, scene, {
  target: { target: 'static', ssr: true, minify: false },
  emitTypeScript: true, // false -> .js modules
});

// result.entry          — 'main.ts'
// result.files          — GeneratedModule[] (path, source, imports)
// result.hydrationManifest — islands for @lumen/runtime hydration
// result.ssrHtml        — pre-rendered index.html shell ('' when ssr off)
// result.importGraph    — module specifiers actually imported
// result.warnings       — non-fatal CodegenWarning[]
```

## Collaboration

- **Consumes** frozen types from `@lumen/contracts` (type-only imports; nothing
  is imported from contracts at runtime).
- The caller (typically the build pipeline) supplies the `TemplateDescriptor`
  from `@lumen/templates` and the `ComposedScene` from
  `descriptor.compose(config, manifest)`; codegen never composes scenes itself.
- The **Build agent** consumes the `CodegenResult.files` (writes them to the
  output tree / feeds them to the bundler), uses `importGraph` for tree-shaking
  checks, and surfaces `warnings` in build logs.
- Generated entry modules import `bootEngine` / `hydrateIslands` from
  `@lumen/runtime`, which hydrates the SceneIR JSON at boot.

## Development

```sh
npm run build       # tsc -p tsconfig.json
npm test            # build + node --test test/
```

Unit tests (`test/`) cover IR lowering from a fixture config + scene, the emit
toolkit (indentation, import dedupe/sort, identifier escaping, JSON/HTML
injection safety), every target's emitted output (valid import statements, no
unescaped identifiers, warnings collected), and `node --check` parseability of
emitted JS modules.
