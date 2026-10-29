/**
 * @lumen/contracts — configuration domain.
 * The declarative EngineConfig DSL, its sub-schemas, and the migration registry.
 */

import type { AssetKind, PreloadStrategy } from './assets.js';
import type { CodegenTarget } from './codegen.js';
import type { InputSource } from './interaction.js';
import type { A11yFallback } from './interaction.js';
import type { TimelineTrack } from './scene.js';
import type { TemplateKind, ThemeTokens } from './templates.js';

/** Reference to a raw asset to be ingested by the build pipeline. */
export interface AssetRef {
  /** Logical asset id, key of the emitted AssetManifest. */
  id: string;
  /** Local path or URL of the source asset. */
  src: string;
  /** Asset category. */
  kind: AssetKind;
  /** Named transcode profile (build-defined). */
  profile?: string;
  /** Preload priority override. */
  preload?: PreloadStrategy;
}

/** Declarative subset of SceneNode authored in config. */
export interface SceneNodeConfig {
  /** Node id (unique within the config). */
  id: string;
  /** Node kind (SceneNode['kind']). */
  kind: 'group' | 'mesh' | 'video-plane' | 'dom' | 'camera' | 'light' | 'sprite';
  /** Asset reference for mesh/video-plane/sprite nodes. */
  assetId?: string;
  /** HTML content for dom nodes. */
  html?: string;
  /** Node-specific metadata. */
  meta?: Record<string, unknown>;
}

/** One scene section, mapped into a template slot. */
export interface SceneConfig {
  /** Unique scene id. */
  id: string;
  /** Target SlotDefinition.id of the selected template. */
  slot: string;
  /** Declarative nodes placed in the slot. */
  nodes: SceneNodeConfig[];
  /** Timeline driver and extent for this scene. */
  track: {
    /** What advances the playhead. */
    driver: TimelineTrack['driver'];
    /** Duration in seconds (time/playback) or scroll units (scroll/pointer). */
    durationOrRange: number;
  };
  /** Accessibility metadata. */
  a11y: { label: string; summary?: string };
}

/** Declarative interaction binding authored in config. */
export interface InteractionConfig {
  /** Unique binding id. */
  id: string;
  /** Input origin. */
  source: InputSource;
  /** Gesture subtype when gesture-driven. */
  gesture?: 'pan' | 'pinch' | 'swipe' | 'tap' | 'longpress';
  /** SceneConfig.id whose track is driven. */
  scene: string;
  /** Input domain (px, radians, or unit deltas). */
  inputRange: [number, number];
  /** Accessibility degradation mode. */
  a11yFallback?: A11yFallback;
}

/**
 * The validated, top-level engine configuration. Single source of truth
 * for scenes, assets, interactions, theming, template selection, and output.
 */
export interface EngineConfig {
  /** Config schema version; migrations upgrade older configs to this. */
  version: 3;
  /** Unique site/engine id. */
  id: string;
  /** Selected frontend type. */
  template: TemplateKind;
  /** Site metadata. */
  meta: { title: string; description: string; locale: string; ogImage?: string };
  /** Theme token overrides merged over the template defaults. */
  theme: Partial<ThemeTokens>;
  /** Raw assets to ingest. */
  assets: AssetRef[];
  /** Scene sections. */
  scenes: SceneConfig[];
  /** Interaction bindings. */
  interactions: InteractionConfig[];
  /** Build/codegen options: output target plus flags. */
  build: CodegenTarget;
}

/** A single linear migration step between config schema versions. */
export interface ConfigMigration {
  /** Source schema version. */
  from: number;
  /** Target schema version (must equal from + 1 in the linear registry). */
  to: number;
  /** Pure upgrade function over the raw parsed config. */
  migrate(cfg: Record<string, unknown>): Record<string, unknown>;
}
