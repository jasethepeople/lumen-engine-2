/**
 * @lumen/contracts — template system domain.
 * Template descriptors, slots, theme tokens, and module requirements
 * that drive composition and tree-shaking.
 */

import type { AssetManifest } from './assets.js';
import type { EngineConfig } from './config.js';
import type { InputSource } from './interaction.js';
import type { RendererBackend } from './rendering.js';
import type { ComposedScene, CubicBezier, SceneNodeKind } from './scene.js';

/** The four frontend types shipped by the engine. */
export type TemplateKind = 'scroll-video' | 'cinematic-spa' | 'viewer-3d' | 'storytelling';

/** Declares a region of a template that config scenes may populate. */
export interface SlotDefinition {
  /** Unique slot id, referenced by SceneConfig.slot. */
  id: string;
  /** SceneNode kinds that may be placed in this slot. */
  accepts: SceneNodeKind[];
  /** Minimum number of scenes required. */
  min: number;
  /** Maximum number of scenes allowed. */
  max: number;
  /** Where the slot renders. */
  region: 'dom' | 'spatial' | 'hybrid';
}

/** Single typographic scale step. */
export interface TypeScaleStep {
  /** CSS size (e.g. '1.25rem'). */
  size: string;
  /** Unitless line height. */
  lineHeight: number;
  /** Font weight. */
  weight: number;
}

/**
 * Theming tokens compiled simultaneously to CSS custom properties (DOM regions)
 * and material uniforms (WebGL regions).
 */
export interface ThemeTokens {
  /** Color tokens keyed by CSS var name (values are CSS colors). */
  colors: Record<string, string>;
  /** Typographic scale keyed by step name (e.g. 'body', 'display'). */
  typeScale: Record<string, TypeScaleStep>;
  /** Spacing tokens keyed by name. */
  spacing: Record<string, string>;
  /** Motion tokens: easing curves and durations. */
  motion: {
    /** Default easing curve. */
    standard: CubicBezier;
    /** Expressive easing curve for hero motion. */
    emphasized: CubicBezier;
    /** Named durations in milliseconds (e.g. 'fast', 'slow'). */
    duration: Record<string, number>;
  };
}

/** Asset pipeline feature flags a template depends on. */
export type AssetFeature = 'hls' | 'draco' | 'lottie' | 'ktx2';

/**
 * Tree-shaking contract: the exact renderer backends, asset features, and
 * interaction sources a template needs. Codegen imports only these modules.
 */
export interface ModuleRequirement {
  /** Required renderer backends, e.g. ['webgl2'] or ['dom', 'canvas2d']. */
  renderers: RendererBackend[];
  /** Required asset pipeline features. */
  assetFeatures: AssetFeature[];
  /** Required interaction input sources. */
  interactions: InputSource[];
}

/** Per-template performance budgets enforced by the build system. */
export interface PerformanceBudget {
  /** Max gzipped JS bytes for the entry + template chunks. */
  jsGzBytes: number;
  /** Max critical (preload: 'critical') asset bytes. */
  criticalAssetBytes: number;
  /** Max time to first frame in milliseconds. */
  firstFrameMs: number;
}

/**
 * A frontend-type definition: slots, theme defaults, module requirements,
 * budgets, and the composition function mapping config + manifest to a scene.
 */
export interface TemplateDescriptor {
  /** Which frontend type this descriptor implements. */
  kind: TemplateKind;
  /** Descriptor semver version. */
  version: string;
  /** Declared slots/regions. */
  slots: SlotDefinition[];
  /** Default theme tokens (overridable via EngineConfig.theme). */
  themeTokens: ThemeTokens;
  /** Tree-shaking contract for codegen. */
  requiredCapabilities: ModuleRequirement;
  /** Per-template performance budgets. */
  budgets: PerformanceBudget;
  /** Compose a validated config and asset manifest into a resolved scene. */
  compose(cfg: EngineConfig, manifest: AssetManifest): ComposedScene;
}
