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

import type { ComposedScene, SceneNode, TimelineTrack } from './scene.js';
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
  /** Whether a video-plane is scrubbed by a track. */
  scrubbed?: boolean;
  /** Timeline property bindings attached to this node. */
  bindings: SceneNode['bindings'];
  /** Template-specific metadata. */
  meta?: Record<string, unknown>;
  children: IRNode[];
}

/** A lowered timeline track. */
export interface IRTrack {
  id: string;
  target: string;
  driver: TimelineTrack['driver'];
  range: [number, number];
  keyframes: TimelineTrack['keyframes'];
}

/** A lowered interaction binding (pass-through of the resolved contract). */
export type IRBinding = InteractionBinding;

/** A runtime asset reference collected from config + scene payloads. */
export interface IRAssetRef {
  id: string;
  src: string;
  kind: EngineConfig['assets'][number]['kind'];
  preload?: NonNullable<EngineConfig['assets'][number]['preload']>;
  /** Known media duration in seconds (video/audio); 0/omitted means unknown. */
  duration?: number;
}

/**
 * The serializable document embedded into generated modules and hydrated
 * by @lumen/runtime at boot.
 */
export interface SceneIR {
  version: typeof SCENE_IR_VERSION;
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
  a11y: Record<string, { label: string; summary?: string }>;
}
