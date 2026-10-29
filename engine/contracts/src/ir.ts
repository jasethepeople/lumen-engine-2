/**
 * SceneIR — the versioned, JSON-serializable scene document that is the
 * handshake between @lumen/codegen (producer), generated entry modules
 * (transport), and @lumen/runtime (consumer). Single owner: contracts.
 *
 * Wire format (frozen): `version: 1` and the JSON shape
 * `site/template/theme/nodes/tracks/bindings/assets/hydration/a11y`.
 * Changing this shape requires bumping SCENE_IR_VERSION and a coordinated
 * update of codegen's lowering and runtime's raising.
 */

import type { ComposedScene, SceneNode, TimelineTrack, Vec3 } from './scene.js';
import type { EngineConfig } from './config.js';
import type { InteractionBinding } from './interaction.js';
import type { ThemeTokens } from './templates.js';

/** Current SceneIR schema version. */
export const SCENE_IR_VERSION = 1 as const;

/** A lowered, serializable scene node (tree structure preserved). */
export interface IRNode {
  id: string;
  kind: SceneNode['kind'];
  transform: SceneNode['transform'];
  layer: number;
  visible: boolean;
  /** Referenced asset id (mesh/sprite/video-plane payloads). */
  assetId?: string;
  /** HTML fragment for dom nodes. */
  html?: string;
  /** Optional 3D anchor for dom nodes (P11; was previously dropped). */
  anchor?: Vec3;
  /** Optional explicit CSS rect for dom nodes (P11). */
  rect?: { x: number; y: number; width: number; height: number };
  /** Optional stacking-context group for dom nodes (P11). */
  layerGroup?: string;
  /** Whether a video-plane is scrubbed by a track. */
  scrubbed?: boolean;
  /** Timeline property bindings attached to this node. */
  bindings: SceneNode['bindings'];
  /** Template-specific metadata. */
  meta?: Record<string, unknown>;
  children: IRNode[];
}

/** Reduced-motion semantics for a track or scene (P1). */
export type MotionMode = 'continuous' | 'reveal' | 'static';

/** A lowered timeline track. */
export interface IRTrack {
  id: string;
  target: string;
  driver: TimelineTrack['driver'];
  range: [number, number];
  keyframes: TimelineTrack['keyframes'];
  /** Per-track reduced-motion override; absent = inherit scene/default. */
  motion?: MotionMode;
  /** Driver-level interpolation policy (P15); absent = global smoothing. */
  smoothing?: TimelineTrack['smoothing'];
  /** Reusable keyframe segments merged into the keyframe stream (P15). */
  segments?: TimelineTrack['segments'];
}

/**
 * Single owner of reduced-motion behavior at runtime (P1). Driver kind never
 * changes; only the interpolation policy does. Resolved per engine boot and
 * consulted by the frame loop, the virtual scroller, and scrub seeks.
 */
export interface MotionPolicy {
  /** Resolved scene-level mode. */
  readonly mode: MotionMode;
  /**
   * Advance the time-driven clock: 'continuous'/'reveal' pass time (dt added);
   * 'static' holds t=0.
   */
  advanceTime(elapsed: number, dt: number): number;
  /** Interpolation policy: 'continuous' lerps; 'reveal'/'static' cut to target. */
  interpolate(current: number, target: number, alpha: number): number;
  /** Scrub quantization: 'reveal' snaps to the nearest boundary; 'static' holds 0. */
  quantizeScrub(seconds: number, boundaries: readonly number[]): number;
  /** Resolve the effective mode for one track (track override beats scene default). */
  trackMode(track: IRTrack): MotionMode;
}

/** A lowered interaction binding (pass-through of the resolved contract). */
export type IRBinding = InteractionBinding;

/** One delivery variant of an asset, preserved across the wire (P2). */
export interface IRAssetVariant {
  src: string;
  /** Container/format hint, e.g. 'avif' | 'webp' | 'mp4' | 'webm' | 'poster'. */
  format?: string;
  /** Codec hint for video variants, e.g. 'h264' | 'hevc' | 'av1' | 'vp9'. */
  codec?: string;
  /** Pixel width when known (responsive srcsets). */
  width?: number;
  /** Transfer size when known. */
  bytes?: number;
  /** Delivery mode; 'gop1' marks all-keyframe scrub encodes. */
  delivery: 'progressive' | 'gop1' | 'frame-stack' | 'hls';
}

/** A runtime asset reference collected from config + scene payloads. */
export interface IRAssetRef {
  id: string;
  src: string;
  kind: EngineConfig['assets'][number]['kind'];
  preload?: NonNullable<EngineConfig['assets'][number]['preload']>;
  /** Known media duration in seconds (video/audio); 0/omitted means unknown. */
  duration?: number;
  /** Rich variants preserved across the wire; `src` remains the fallback. */
  variants?: IRAssetVariant[];
}

/**
 * The serializable document embedded into generated modules and hydrated
 * by @lumen/runtime at boot.
 */
export interface SceneIR {
  version: typeof SCENE_IR_VERSION;
  /**
   * P8: minimum @lumen/runtime semver required to boot this document.
   * Stamped by codegen; the runtime throws VersionSkewError at parse time
   * when its own version is older, letting hosts degrade gracefully
   * (keep the SSR skeleton) instead of failing midway through boot.
   */
  minRuntime?: string;
  /** Site metadata from config.meta. */
  site: {
    id: string;
    title: string;
    description: string;
    locale: string;
    ogImage?: string;
  };
  /** Selected template kind. */
  template: EngineConfig['template'];
  /** Fully-resolved theme tokens (descriptor defaults merged with overrides). */
  theme: ThemeTokens;
  /** Scene node forest. */
  nodes: IRNode[];
  /** All timeline tracks. */
  tracks: IRTrack[];
  /** Resolved interaction bindings. */
  bindings: IRBinding[];
  /** Runtime asset references. */
  assets: IRAssetRef[];
  /** Hydration hints from composition. */
  hydration: ComposedScene['hydration'];
  /** Per-scene accessibility metadata keyed by scene id. */
  a11y: Record<string, { label: string; summary?: string; motion?: MotionMode }>;
}
