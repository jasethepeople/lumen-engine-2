/**
 * @lumen/codegen — intermediate representation (IR).
 *
 * Lowers a validated EngineConfig plus the ComposedScene produced by a
 * TemplateDescriptor into a serializable SceneIR JSON document. Generated
 * entry modules embed this IR and hand it to @lumen/runtime, which hydrates
 * the live scene graph from JSON at boot.
 */

import type {
  AssetManifest,
  ComposedScene,
  EasingName,
  EngineConfig,
  IRAssetRef,
  IRAssetVariant,
  IRNode,
  SceneIR,
  SceneNode,
  ThemeTokens,
  TimelineTrack,
} from '@lumen/contracts';
import { SCENE_IR_VERSION } from '@lumen/contracts';
import { resolveThemeTokens } from '@lumen/templates';

// The SceneIR document is owned by @lumen/contracts (single declaration of the
// codegen -> generated code -> runtime handshake). Re-exported here for source
// compatibility with existing codegen consumers.
export { SCENE_IR_VERSION } from '@lumen/contracts';

/** P8: minimum @lumen/runtime version able to boot documents we lower. */
export const MIN_RUNTIME_VERSION = '0.1.0';
export type { IRAssetRef, IRBinding, IRNode, IRTrack, SceneIR } from '@lumen/contracts';

/** Nearest named easing to a cubic bezier (forward-compat fallback, P15). */
function nearestEasingName(bezier: readonly [number, number, number, number]): EasingName {
  const named: Record<EasingName, (t: number) => number> = {
    linear: (t) => t,
    'ease-in': (t) => t * t,
    'ease-out': (t) => 1 - (1 - t) * (1 - t),
    'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    step: (t) => (t < 1 ? 0 : 1),
  };
  // Sample the bezier's y curve at the bezier's own x parameterization.
  const [x1, y1, x2, y2] = bezier;
  const sample = (u: number): number => {
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    return ((ay * u + by) * u + cy) * u;
  };
  void x1;
  void x2;
  let best: EasingName = 'linear';
  let bestErr = Infinity;
  for (const [name, fn] of Object.entries(named) as [EasingName, (t: number) => number][]) {
    let err = 0;
    for (const u of [0.25, 0.5, 0.75]) err += (sample(u) - fn(u)) ** 2;
    if (err < bestErr) {
      bestErr = err;
      best = name;
    }
  }
  return best;
}

/**
 * Forward-compat keyframe pass (P15): keyframes carrying `easingBezier` also
 * get the nearest `EasingName` in legacy `easing` so old runtimes degrade to
 * the named curve instead of dropping the easing entirely. Keyframes without
 * a bezier pass through by reference (byte-identical output).
 */
function lowerKeyframes(keys: TimelineTrack['keyframes']): TimelineTrack['keyframes'] {
  if (!keys.some((k) => k.easingBezier !== undefined && k.easing === undefined)) return keys;
  return keys.map((k) =>
    k.easingBezier !== undefined && k.easing === undefined
      ? { ...k, easing: nearestEasingName(k.easingBezier) }
      : k,
  );
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
    // P11: dom payload richness — anchor was previously dropped on the wire.
    if ('anchor' in payload && payload.anchor !== undefined) ir.anchor = payload.anchor;
    if ('rect' in payload && payload.rect !== undefined) ir.rect = payload.rect;
    if ('layerGroup' in payload && payload.layerGroup !== undefined) ir.layerGroup = payload.layerGroup;
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
 * Flatten a manifest entry's rich variants into wire IRAssetVariants (P2).
 * Returns undefined when the entry is missing or carries no variant info,
 * so lowering without a manifest stays byte-identical.
 */
function variantsFromManifestEntry(
  manifest: AssetManifest | undefined,
  id: string,
): IRAssetVariant[] | undefined {
  const entry = manifest?.assets[id];
  if (!entry) return undefined;
  const out: IRAssetVariant[] = [];
  if (entry.kind === 'image') {
    for (const format of ['avif', 'webp'] as const) {
      const srcset = entry.variants[format]?.srcset;
      if (!srcset) continue;
      for (const [w, src] of Object.entries(srcset)) {
        out.push({ src, format, width: Number(w), delivery: 'progressive' });
      }
    }
    out.push({ src: entry.variants.fallback.url, delivery: 'progressive' });
  } else if (entry.kind === 'video') {
    const delivery = entry.scrubOptimized ? 'gop1' : 'progressive';
    if (entry.variants.mp4) {
      out.push({
        src: entry.variants.mp4.url,
        format: 'mp4',
        codec: entry.variants.mp4.codec,
        bytes: entry.variants.mp4.bytes,
        delivery,
      });
    }
    if (entry.variants.webm) {
      out.push({
        src: entry.variants.webm.url,
        format: 'webm',
        bytes: entry.variants.webm.bytes,
        delivery,
      });
    }
    if (entry.variants.hls) {
      out.push({ src: entry.variants.hls.playlist, format: 'hls', delivery: 'hls' });
    }
    if (entry.poster) out.push({ src: entry.poster, format: 'poster', delivery: 'progressive' });
  } else {
    return undefined;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Lower config + composed scene into a SceneIR document.
 * `descriptor` supplies the default theme tokens; `scene` is the result of
 * `descriptor.compose(cfg, manifest)` provided by the caller.
 * When the optional `manifest` is given, rich asset variants are preserved
 * on the wire (P2); without it, output is byte-identical to before.
 */
export function lowerToIR(
  config: EngineConfig,
  defaults: ThemeTokens,
  scene: ComposedScene,
  manifest?: AssetManifest,
): SceneIR {
  const a11y: SceneIR['a11y'] = {};
  for (const sc of config.scenes) {
    a11y[sc.id] = { label: sc.a11y.label };
    if (sc.a11y.summary !== undefined) a11y[sc.id].summary = sc.a11y.summary;
    if (sc.a11y.motion !== undefined) a11y[sc.id].motion = sc.a11y.motion;
  }
  const ir: SceneIR = {
    version: SCENE_IR_VERSION,
    // P8: stamp the minimum runtime this document was lowered for so an
    // older deployed runtime can detect the skew and degrade gracefully.
    minRuntime: MIN_RUNTIME_VERSION,
    site: {
      id: config.id,
      title: config.meta.title,
      description: config.meta.description,
      locale: config.meta.locale,
    },
    template: config.template,
    theme: resolveThemeTokens(defaults, config.theme),
    nodes: scene.sceneGraph.map(lowerNode),
    tracks: scene.tracks.map((t) => ({
      id: t.id,
      target: t.target,
      driver: t.driver,
      range: t.range,
      keyframes: lowerKeyframes(t.keyframes),
      ...(t.motion !== undefined ? { motion: t.motion } : {}),
      ...(t.smoothing !== undefined ? { smoothing: t.smoothing } : {}),
      ...(t.segments !== undefined ? { segments: t.segments } : {}),
    })),
    bindings: scene.bindings.slice(),
    assets: config.assets.map((a) => {
      const ref: IRAssetRef = { id: a.id, src: a.src, kind: a.kind };
      if (a.preload !== undefined) ref.preload = a.preload;
      if (a.duration !== undefined) ref.duration = a.duration;
      const variants = variantsFromManifestEntry(manifest, a.id);
      if (variants !== undefined) ref.variants = variants;
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
