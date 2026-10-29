/**
 * @lumen/contracts — asset pipeline domain.
 * Versioned asset manifest, per-kind asset entries, load states, and preload strategy.
 */

/** Asset categories handled by the pipeline. */
export type AssetKind = 'image' | 'video' | 'model' | 'font' | 'lottie' | 'audio';

/** Preload priority assigned to an asset. */
export type PreloadStrategy = 'critical' | 'eager' | 'lazy';

/** Runtime load state of a single asset. */
export type LoadState = 'queued' | 'loading' | 'ready' | 'error';

/** Base fields shared by every manifest entry. */
interface AssetEntryBase {
  /** Logical asset id (manifest key). */
  id: string;
  /** Preload priority. */
  preload: PreloadStrategy;
  /** Total transferred bytes across variants. */
  bytes: number;
  /**
   * Rich wire variants this entry was synthesized from (P2/P7 seam).
   * Present only on entries materialized from `IRAssetRef.variants` at
   * boot; build-pipeline manifests leave it absent.
   */
  irVariants?: import('./ir.js').IRAssetVariant[];
}

/** Raster image asset with responsive variants. */
export interface ImageAssetEntry extends AssetEntryBase {
  kind: 'image';
  /** Intrinsic pixel dimensions. */
  width: number;
  height: number;
  /** Responsive variants keyed by format. */
  variants: {
    avif?: { srcset: Record<number, string> };
    webp?: { srcset: Record<number, string> };
    fallback: { url: string; mime: string };
  };
  /** Dominant color (hex) for placeholder paint. */
  dominantColor?: string;
}

/** Video asset: HLS ladder plus progressive fallbacks and a poster frame. */
export interface VideoAssetEntry extends AssetEntryBase {
  kind: 'video';
  /** Duration in seconds. */
  duration: number;
  /** Intrinsic pixel dimensions. */
  width: number;
  height: number;
  /** Hashed poster frame URL. */
  poster: string;
  /** Delivery variants. */
  variants: {
    hls?: { playlist: string; bandwidths: number[] };
    mp4?: { url: string; bytes: number; codec: 'h264' | 'hevc' | 'av1' };
    webm?: { url: string; bytes: number };
  };
  /** All-keyframe / low-GOP encode suitable for scroll scrubbing. */
  scrubOptimized: boolean;
}

/** 3D model asset (GLB, meshopt-compressed). */
export interface ModelAssetEntry extends AssetEntryBase {
  kind: 'model';
  /** URL of the compressed .glb. */
  url: string;
  /** Texture encoding used by the model. */
  textures: 'ktx2' | 'webp-fallback';
  /** Draco geometry compression applied. */
  draco: boolean;
  /** Axis-aligned bounding box. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Subsetted WOFF2 font asset. */
export interface FontAssetEntry extends AssetEntryBase {
  kind: 'font';
  /** Font family name as used in CSS. */
  family: string;
  /** URL of the subset WOFF2 file. */
  url: string;
  /** Font weight. */
  weight: number;
  /** Font style. */
  style: 'normal' | 'italic';
  /** Unicode ranges covered by the subset. */
  unicodeRanges?: string[];
}

/** Lottie animation asset. */
export interface LottieAssetEntry extends AssetEntryBase {
  kind: 'lottie';
  /** URL of the Lottie JSON. */
  url: string;
  /** Composition duration in seconds. */
  duration: number;
  /** Composition frame rate. */
  frameRate: number;
}

/** Audio asset. */
export interface AudioAssetEntry extends AssetEntryBase {
  kind: 'audio';
  /** Duration in seconds. */
  duration: number;
  /** Delivery variants keyed by codec. */
  variants: {
    aac?: { url: string; bytes: number };
    opus?: { url: string; bytes: number };
  };
}

/** Discriminated union of all manifest entry kinds (discriminant: `kind`). */
export type AssetEntry =
  | ImageAssetEntry
  | VideoAssetEntry
  | ModelAssetEntry
  | FontAssetEntry
  | LottieAssetEntry
  | AudioAssetEntry;

/**
 * Versioned, content-hashed asset manifest mapping logical ids to variant URLs,
 * byte sizes, and preload priorities. Emitted at build; consumed at runtime.
 */
export interface AssetManifest {
  /** Manifest schema version. */
  version: 1;
  /** ISO-8601 generation timestamp. */
  generatedAt: string;
  /** Entries keyed by logical asset id. */
  assets: Record<string, AssetEntry>;
}
