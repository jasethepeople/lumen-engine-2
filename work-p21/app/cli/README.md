# @lumen/cli — `lumen-media`

Media pipeline CLI for the Lumen engine (Phase 7 hybrid variants). Produces
the scrub-optimized desktop encode, the mobile frame stack, and the
IRAssetRef / AssetManifest JSON that wires them into the runtime.

- Node >= 20, ESM, **zero runtime dependencies** (only `node:*` modules).
- `ffmpeg` / `ffprobe` are used as **external binaries** on PATH.
- Everything type-imports `@lumen/contracts` (erased at compile time), so the
  emitted JSON matches `contracts/src/ir.ts` (IRAssetRef / IRAssetVariant,
  P2) and `contracts/src/assets.ts` (video AssetEntry) exactly.

## Install / build

```sh
bash scripts/build-all.sh          # compiles app/cli along with the engine
node app/cli/dist/bin/lumen-media.js --help
# or, with the workspace linked / installed: lumen-media --help
```

Requires `ffmpeg` on PATH for `scrub`/`frames` and `ffprobe` for `probe`.
Missing binaries fail up-front with a clear install hint; `--dry-run` prints
the exact commands without needing ffmpeg at all. AVIF frame stacks require
an AV1 encoder in the ffmpeg build (`libaom-av1`/`librav1e`/`libsvtav1`);
without one the CLI errors and suggests `--format webp`.

## Commands

### `lumen-media scrub <input.mp4> -o out/ [--width 1920] [--crf 23]`

Keyframe-dense desktop scrub MP4: H.264, **GOP=1** (`-g 1`, every frame an
IDR), **no B-frames** (`-bf 0`), `+faststart`, audio stripped, scaled down to
at most `--width` px. This is the `delivery: 'gop1'` variant the runtime
seeks frame-accurately during scroll scrubbing on desktop.

### `lumen-media frames <input.mp4> -o out/ --format webp|avif --fps 30`

Mobile frame stack: extracts `frame-00001.webp` … via `-vf fps=N`. This is
the `delivery: 'frame-stack'` variant used on mobile, where `<img>` swapping
is reliable and `<video>` seeking is not.

### `lumen-media probe <input>`

ffprobe wrapper printing `{ duration, codec, width, height, fps }` as JSON.
The `duration` value feeds `IRAssetRef.duration` and the video AssetEntry
`duration` plumbing (used by `manifest`, overridable via `--duration`).

### `lumen-media manifest <name> --scrub out/x-scrub.mp4 --frames out/frames/ [--hls stream.m3u8]`

Writes `<name>.asset.json` — an IRAssetRef-compatible object:

```json
{
  "id": "hero",
  "src": "out/hero-scrub.mp4",
  "kind": "video",
  "preload": "lazy",
  "duration": 8.2,
  "variants": [
    { "src": "out/hero-scrub.mp4", "format": "mp4", "codec": "h264",
      "delivery": "gop1", "bytes": 74129 },
    { "src": "out/frames/frame-%05d.webp", "format": "webp",
      "delivery": "frame-stack", "fps": 30, "frameCount": 246,
      "pattern": "out/frames/frame-%05d.webp" },
    { "src": "stream.m3u8", "format": "hls", "codec": "h264", "delivery": "hls" }
  ]
}
```

`frameCount` is counted from the actual files on disk. It also prints a
merged **AssetManifest snippet** (video `AssetEntry` with
`scrubOptimized: true`, `irVariants`, poster, and `mp4`/`hls` variants) that
validates against `@lumen/assets` `normalizeManifest`.

## Plugging into the engine

The `.asset.json` files are collected into `EngineConfig.assets` / the
SceneIR `assets` array (codegen lowers them 1:1 — `IRAssetRef.variants` is
the P2 wire shape). At boot the runtime materializes them into manifest
entries (`irVariants` on the AssetEntry). During playback the P7
capability-aware selector — `pickVariant(profile, variants, 'video')` in
`@lumen/assets` — chooses per device:

- **desktop + scroll scrub** → the `gop1` scrub MP4 (cheap seeks);
- **mobile / memory-constrained** → the `frame-stack` (no video decode);
- **streaming hosts** → the `hls` playlist;
- unsupported codecs are dropped using the probed codec matrix before width
  fitting, so a `hevc` scrub encode is never picked where it can't play.

Typical pipeline:

```sh
lumen-media scrub hero.mp4 -o public/media/
lumen-media frames hero.mp4 -o public/media/hero-frames --fps 30
lumen-media manifest hero \
  --scrub public/media/hero-scrub.mp4 \
  --frames public/media/hero-frames \
  --hls /cdn/hero/stream.m3u8 \
  -o src/assets/
```

## Global flags

- `--dry-run` — print the ffmpeg/ffprobe commands, execute nothing.
- `--timeout-ms N` — kill any ffmpeg invocation after N ms (default 600000).

## Tests

```sh
node --test app/cli/test/
```

Covers command construction (dry-run output), manifest JSON validity against
the real contracts shapes and the real `normalizeManifest` validator, and
frame-count scanning. Tests that need ffmpeg are skipped automatically when
the binary is absent.
