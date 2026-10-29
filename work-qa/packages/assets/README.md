# @lumen/assets

Lumen engine asset pipeline: manifest handling, priority preloading, two-tier
caching, and per-kind runtime loaders. Consumes the frozen contract types from
`@lumen/contracts` (`AssetManifest`, `AssetEntry`, `LoadState`,
`PreloadStrategy`, and the `asset:progress` event payload).

## Responsibilities

- **Manifest handling** (`manifest.ts`): validate + normalize the versioned,
  content-hashed `AssetManifest` emitted at build time; resolve
  manifest-relative URLs against a CDN base; group assets by preload priority;
  derive stable content-hash cache keys from hash-addressed CDN paths
  (`/assets/<hash>/<name>.<ext>`).
- **Per-kind loaders** (`loader.ts`): image (fetch + `createImageBitmap`
  decode), video (metadata wait, scrub-optimized MP4/WebM selection,
  `requestVideoFrameCallback` frame-scrub wrapper, native-HLS-or-HLS.js for
  linear playback), model (GLTF/GLB fetch → `ArrayBuffer`; parsing/Draco/
  meshopt decode is the renderer's job), font (`FontFace` API, guarded),
  lottie (JSON fetch), audio (bytes + optional `AudioContext` decode). Every
  load reports `LoadState` transitions (`queued → loading → ready | error`).
- **Preloading** (`preload.ts`): deterministic priority queue
  (critical → eager → lazy, ties by id), concurrency-limited worker pool
  (default 4), abort support, and progress aggregation emitting the frozen
  `asset:progress` payload `{ loaded, total, assetId? }` through an injected
  `emit` callback — the module never imports the kernel.
- **Caching** (`cache.ts`): two-tier cache. Tier 1 is an in-memory LRU
  (entry-count and byte budgets). Tier 2 is persistent — Cache API preferred,
  IndexedDB fallback — and degrades to a safe no-op under Node. Keys are
  content-hash keys, so manifest bumps invalidate stale entries naturally.
- **Facade** (`manager.ts`): `AssetManager` with `init(manifest, opts)`,
  `preload(ids?)`, `get(id)`, `state(id)`, `stats()`, `abort()`, `dispose()`.

## API

```ts
import { createAssetManager } from '@lumen/assets';

const assets = createAssetManager();

assets.init(manifestJson, {
  cdnBase: 'https://cdn.example.com',
  concurrency: 4,
  // Wire progress into the kernel bus (kernel-agnostic by design):
  emit: (payload) => bus.emit('asset:progress', payload),
});

await assets.preload();              // all non-ready entries, priority order
await assets.preload(['hero']);      // or a subset

const hero = assets.get('hero');     // AssetHandle | undefined
if (hero?.kind === 'image' && hero.bitmap) { /* draw */ }

const video = assets.get('intro');
if (video?.kind === 'video') {
  await video.video.seekTo(t);       // frame-accurate scrub via rVFC
  const off = video.video.onFrame((mediaTime) => { /* ... */ });
}

assets.stats();                      // { total, ready, loading, failed, cacheEntries, cacheBytes }
await assets.dispose();
```

Lower-level building blocks are also exported for Templates/Codegen and
tooling: `normalizeManifest`, `isAssetManifest`, `resolveAssetUrl`,
`groupByPriority`, `primaryUrl`, `contentHashKey`, `AssetPriorityQueue`,
`buildQueue`, `preload`, `LruCache`, `PersistentCache`, `AssetCache`,
`loadAsset`.

## Environment guards / browser-only loaders

The runtime-loading side has **zero required dependencies** and imports
cleanly under Node:

- Image decode uses `createImageBitmap` when present; under Node the handle
  still carries the raw bytes with `bitmap: null`.
- Video requires a DOM (`HTMLVideoElement`); in Node it throws
  `UnsupportedEnvironmentError` (surfaced as a per-asset `error` result).
  HLS.js is loaded only via a guarded dynamic `import()`, only when the
  browser lacks native HLS and only for linear (non-scrub) playback —
  scrub-optimized videos always use the progressive MP4/WebM variant.
- Font loading uses the `FontFace` API + `document.fonts` when available;
  otherwise the raw WOFF2 bytes are returned.
- Audio decode uses `AudioContext.decodeAudioData` when available; raw bytes
  are always returned.
- The persistent cache tier no-ops outside browsers.

## Tests

```
npm test   # tsc -p tsconfig.build.json && node --test test/
```

Covers manifest normalization/validation, priority-queue ordering, LRU
eviction (count + byte budgets, recency), concurrency limiting, progress
aggregation, failure isolation, abort, and the manager facade. Browser-only
loaders are exercised through their guarded paths (documented above).

## Collaboration

- **Templates / Codegen** consume the manifest shape (`AssetManifest`,
  `AssetEntry` discriminated by `kind`) to declare asset references and emit
  preload hints; they should treat entries as opaque and key everything by
  logical id.
- **Build** emits the manifest; `contentHashKey()` defines the cache-key
  contract it must honor (hash-addressed `/assets/<hash>/...` paths).
- **Kernel** receives `asset:progress` payloads via the `emit` callback it
  injects at `init()`; this package never imports kernel code.
- **Rendering** receives decoded handles (`ImageBitmap`, `LoadedVideo`,
  `ArrayBuffer` for GLB) from `AssetManager.get()`.

## Notes / contract gaps

None. All cross-module types come from `@lumen/contracts` unchanged.

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
