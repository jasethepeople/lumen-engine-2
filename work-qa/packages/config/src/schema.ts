/**
 * @lumen/config — EngineConfig schema.
 *
 * Hand-rolled validators mirroring every field of the frozen contract
 * types in `@lumen/contracts` (contracts/src/config.ts). Produces a fully
 * typed `EngineConfig` or an exhaustive, path-aware error list.
 */

import type {
  AssetRef,
  EngineConfig,
  InteractionConfig,
  SceneConfig,
  SceneNodeConfig,
} from '@lumen/contracts';
import type { AssetKind, PreloadStrategy } from '@lumen/contracts';
import type { CodegenTarget } from '@lumen/contracts';
import type { A11yFallback, InputSource } from '@lumen/contracts';
import type { TemplateKind, ThemeTokens } from '@lumen/contracts';
import {
  array,
  boolean,
  enumOf,
  number,
  object,
  optional,
  recordOf,
  string,
  tuple,
  type ValidationError,
  type Validator,
} from './validate.js';

/** Current schema version carried by validated configs. */
export const CONFIG_VERSION = 3 as const;

const ASSET_KINDS = ['image', 'video', 'model', 'font', 'lottie', 'audio'] as const satisfies readonly AssetKind[];
const PRELOAD_STRATEGIES = ['critical', 'eager', 'lazy'] as const satisfies readonly PreloadStrategy[];
const TEMPLATE_KINDS = ['scroll-video', 'cinematic-spa', 'viewer-3d', 'storytelling'] as const satisfies readonly TemplateKind[];
const INPUT_SOURCES = ['scroll', 'pointer', 'touch', 'keyboard', 'deviceorientation'] as const satisfies readonly InputSource[];
const A11Y_FALLBACKS = ['steps', 'static', 'native-video'] as const satisfies readonly A11yFallback[];
const NODE_KINDS = ['group', 'mesh', 'video-plane', 'dom', 'camera', 'light', 'sprite'] as const satisfies readonly SceneNodeConfig['kind'][];
const TRACK_DRIVERS = ['time', 'scroll', 'pointer', 'playback'] as const;
const GESTURES = ['pan', 'pinch', 'swipe', 'tap', 'longpress'] as const;
const BUILD_TARGETS = ['static', 'webcomponent', 'npm', 'runtime'] as const;
const MODULE_FORMATS = ['esm', 'cjs', 'iife'] as const;

/** Validates a CSS color-ish token string (hex, rgb(), hsl(), var(), named). */
const cssColor: Validator<string> = (input, path) => {
  const r = string({ nonEmpty: true })(input, path);
  if (!r.ok) return r;
  return okOrColor(r.value, path);
};

function okOrColor(value: string, path: string) {
  const re = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[A-Za-z0-9-]+\)|[a-zA-Z]+)$/;
  return re.test(value.trim())
    ? ({ ok: true as const, value })
    : { ok: false as const, errors: [{ path, message: `expected CSS color, got ${JSON.stringify(value)}` }] };
}

/** Validates a cubic-bezier tuple with x components clamped to [0,1]. */
const cubicBezier = tuple(
  number({ min: 0 }),
  number(),
  number({ min: 0 }),
  number(),
) as Validator<[number, number, number, number]>;

const typeScaleStep = object({
  /** Font size (CSS length). */
  size: string({ nonEmpty: true }),
  /** Unitless line height. */
  lineHeight: number({ min: 0 }),
  /** Font weight. */
  weight: number(),
});

const themeTokens: Validator<Partial<ThemeTokens>> = object({
  colors: optional(recordOf(cssColor)),
  typeScale: optional(recordOf(typeScaleStep)),
  spacing: optional(recordOf(string({ nonEmpty: true }))),
  motion: optional(
    object({
      standard: optional(cubicBezier),
      emphasized: optional(cubicBezier),
      duration: optional(recordOf(number({ min: 0 }))),
    }),
  ),
}) as Validator<Partial<ThemeTokens>>;

const assetRef: Validator<AssetRef> = object({
  id: string({ nonEmpty: true }),
  src: string({ nonEmpty: true }),
  kind: enumOf(ASSET_KINDS),
  profile: optional(string({ nonEmpty: true })),
  preload: optional(enumOf(PRELOAD_STRATEGIES)),
  duration: optional(number({ min: 0 })),
}) as Validator<AssetRef>;

const sceneNodeConfig: Validator<SceneNodeConfig> = object({
  id: string({ nonEmpty: true }),
  kind: enumOf(NODE_KINDS),
  assetId: optional(string({ nonEmpty: true })),
  html: optional(string()),
  meta: optional(recordOf((input) => ({ ok: true as const, value: input }))),
}) as Validator<SceneNodeConfig>;

const sceneConfig: Validator<SceneConfig> = object({
  id: string({ nonEmpty: true }),
  slot: string({ nonEmpty: true }),
  nodes: array(sceneNodeConfig),
  track: object({
    driver: enumOf(TRACK_DRIVERS),
    durationOrRange: number({ min: 0 }),
  }),
  a11y: object({
    label: string({ nonEmpty: true }),
    summary: optional(string()),
  }),
}) as Validator<SceneConfig>;

const interactionConfig: Validator<InteractionConfig> = object({
  id: string({ nonEmpty: true }),
  source: enumOf(INPUT_SOURCES),
  gesture: optional(enumOf(GESTURES)),
  scene: string({ nonEmpty: true }),
  inputRange: tuple(number(), number()),
  a11yFallback: optional(enumOf(A11Y_FALLBACKS)),
}) as Validator<InteractionConfig>;

const codegenTarget: Validator<CodegenTarget> = object({
  target: enumOf(BUILD_TARGETS),
  minify: optional(boolean()),
  ssr: optional(boolean()),
  moduleFormat: optional(enumOf(MODULE_FORMATS)),
}) as Validator<CodegenTarget>;

/** The full EngineConfig validator (every field of the contract type). */
export const engineConfigSchema: Validator<EngineConfig> = object({
  version: (input, path) =>
    input === CONFIG_VERSION
      ? ({ ok: true, value: CONFIG_VERSION } as const)
      : { ok: false as const, errors: [{ path, message: `expected version ${CONFIG_VERSION}, got ${JSON.stringify(input)} (run migrations first)` }] },
  id: string({ nonEmpty: true }),
  template: enumOf(TEMPLATE_KINDS),
  meta: object({
    title: string({ nonEmpty: true }),
    description: string(),
    locale: string({ nonEmpty: true }),
    ogImage: optional(string({ nonEmpty: true })),
  }),
  theme: themeTokens,
  assets: array(assetRef),
  scenes: array(sceneConfig),
  interactions: array(interactionConfig),
  build: codegenTarget,
}) as Validator<EngineConfig>;

/** Outcome of validating a raw config object. */
export type ConfigValidationOutcome =
  | { ok: true; config: EngineConfig }
  | { ok: false; errors: ValidationError[] };

/**
 * Validates a raw (already migrated) config object against the full schema,
 * plus cross-field invariants that combinators cannot express:
 * unique ids, interaction→scene references, node→asset references.
 */
export function validateConfig(input: unknown): ConfigValidationOutcome {
  const r = engineConfigSchema(input, '');
  if (!r.ok) return { ok: false, errors: r.errors };
  const config = r.value;
  const errors: ValidationError[] = [];

  const checkUnique = (ids: string[], kind: string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) errors.push({ path: `${kind}[${i}].id`, message: `duplicate ${kind} id ${JSON.stringify(id)}` });
      seen.add(id);
    });
  };
  checkUnique(config.assets.map((a) => a.id), 'assets');
  checkUnique(config.scenes.map((s) => s.id), 'scenes');
  checkUnique(config.interactions.map((i) => i.id), 'interactions');

  const sceneIds = new Set(config.scenes.map((s) => s.id));
  config.interactions.forEach((interaction, i) => {
    if (!sceneIds.has(interaction.scene)) {
      errors.push({
        path: `interactions[${i}].scene`,
        message: `references unknown scene ${JSON.stringify(interaction.scene)}`,
      });
    }
  });

  const assetIds = new Set(config.assets.map((a) => a.id));
  config.scenes.forEach((scene, si) => {
    scene.nodes.forEach((node, ni) => {
      if (node.assetId !== undefined && !assetIds.has(node.assetId)) {
        errors.push({
          path: `scenes[${si}].nodes[${ni}].assetId`,
          message: `references unknown asset ${JSON.stringify(node.assetId)}`,
        });
      }
      if ((node.kind === 'mesh' || node.kind === 'video-plane' || node.kind === 'sprite') && node.assetId === undefined) {
        errors.push({ path: `scenes[${si}].nodes[${ni}].assetId`, message: `kind '${node.kind}' requires an assetId` });
      }
      if (node.kind === 'dom' && node.html === undefined) {
        errors.push({ path: `scenes[${si}].nodes[${ni}].html`, message: `kind 'dom' requires html content` });
      }
    });
  });

  return errors.length === 0 ? { ok: true, config } : { ok: false, errors };
}
