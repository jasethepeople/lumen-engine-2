/**
 * @lumen/codegen — intermediate representation (IR).
 *
 * Lowers a validated EngineConfig plus the ComposedScene produced by a
 * TemplateDescriptor into a serializable SceneIR JSON document. Generated
 * entry modules embed this IR and hand it to @lumen/runtime, which hydrates
 * the live scene graph from JSON at boot.
 */

import type {
  ComposedScene,
  EngineConfig,
  InteractionBinding,
  SceneNode,
  ThemeTokens,
  TimelineTrack,
} from '@lumen/contracts';

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

/** Deep-merge token records (override wins per leaf key). */
function mergeRecords<T>(base: Record<string, T>, over: Partial<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Merge a partial theme over descriptor defaults into full ThemeTokens. */
export function mergeTheme(base: ThemeTokens, over: EngineConfig['theme']): ThemeTokens {
  return {
    colors: mergeRecords(base.colors, over.colors ?? {}),
    typeScale: mergeRecords(base.typeScale, over.typeScale ?? {}),
    spacing: mergeRecords(base.spacing, over.spacing ?? {}),
    motion: {
      standard: over.motion?.standard ?? base.motion.standard,
      emphasized: over.motion?.emphasized ?? base.motion.emphasized,
      duration: mergeRecords(base.motion.duration, over.motion?.duration ?? {}),
    },
  };
}

/** Lower one SceneNode into an IRNode, recursively. */
function lowerNode(node: SceneNode): IRNode {
  const ir: IRNode = {
    id: node.id,
    kind: node.kind,
    transform: node.transform,
    layer: node.layer,
    visible: node.visible,
    bindings: node.bindings,
    children: node.children.map(lowerNode),
  };
  if (node.meta !== undefined) ir.meta = node.meta;
  const payload = node.payload;
  if (payload) {
    if ('assetId' in payload) ir.assetId = payload.assetId;
    if ('html' in payload) ir.html = payload.html;
    if ('scrubbed' in payload) ir.scrubbed = payload.scrubbed;
  }
  return ir;
}

/** Walk an IR node forest, depth-first, invoking `visit` per node. */
export function walkIR(nodes: IRNode[], visit: (node: IRNode) => void): void {
  for (const node of nodes) {
    visit(node);
    walkIR(node.children, visit);
  }
}

/**
 * Lower config + composed scene into a SceneIR document.
 * `descriptor` supplies the default theme tokens; `scene` is the result of
 * `descriptor.compose(cfg, manifest)` provided by the caller.
 */
export function lowerToIR(
  config: EngineConfig,
  defaults: ThemeTokens,
  scene: ComposedScene,
): SceneIR {
  const a11y: SceneIR['a11y'] = {};
  for (const sc of config.scenes) {
    a11y[sc.id] = { label: sc.a11y.label };
    if (sc.a11y.summary !== undefined) a11y[sc.id].summary = sc.a11y.summary;
  }
  const ir: SceneIR = {
    version: SCENE_IR_VERSION,
    site: {
      id: config.id,
      title: config.meta.title,
      description: config.meta.description,
      locale: config.meta.locale,
    },
    template: config.template,
    theme: mergeTheme(defaults, config.theme),
    nodes: scene.sceneGraph.map(lowerNode),
    tracks: scene.tracks.map((t) => ({
      id: t.id,
      target: t.target,
      driver: t.driver,
      range: t.range,
      keyframes: t.keyframes,
    })),
    bindings: scene.bindings.slice(),
    assets: config.assets.map((a) => {
      const ref: IRAssetRef = { id: a.id, src: a.src, kind: a.kind };
      if (a.preload !== undefined) ref.preload = a.preload;
      return ref;
    }),
    hydration: scene.hydration,
    a11y,
  };
  if (config.meta.ogImage !== undefined) ir.site.ogImage = config.meta.ogImage;
  return ir;
}

/** Serialize a SceneIR to JSON (deterministic key order per our emit). */
export function serializeIR(ir: SceneIR): string {
  return JSON.stringify(ir);
}
