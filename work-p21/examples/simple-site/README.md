# examples/simple-site

A minimal Lumen engine site: a scroll-scrubbed video stage with DOM text
overlays, authored entirely as `engine.config.json` (two scenes, placeholder
remote asset URLs — no binary assets needed).

## Run

```sh
# from the repository root, after the workspace is built:
bash scripts/build-all.sh
node examples/simple-site/build-example.mjs
```

The script runs the full pipeline:

1. `@lumen/config` — `parseConfig()` (migrate → validate → defaults).
2. `@lumen/templates` — registry lookup + `compose()` into a `ComposedScene`.
3. `@lumen/codegen` — `generate()` for the `static` target (SceneIR module +
   SSR `index.html` with `<noscript>` fallback).
4. `@lumen/build` — the build pipeline (validate → generate → optimize →
   hash → emit → report) writing content-hashed files plus `manifest.json`
   and a budget report into `dist/`.

Output lands in `dist/`. The emitted `main.*.js` imports `bootEngine` /
`hydrateIslands` from `@lumen/runtime`; serve the directory over HTTP in a
browser to boot the site.
