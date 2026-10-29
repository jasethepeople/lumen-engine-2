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
  IRAssetRef,
  IRNode,
  SceneIR,
  SceneNode,
  ThemeTokens,
} from '@lumen/contracts';
import { SCENE_IR_VERSION } from '@lumen/contracts';
import { resolveThemeTokens } from '@lumen/templates';

// The SceneIR document is owned by @lumen/contracts (single declaration of the
// codegen -> generated code -> runtime handshake). Re-exported here for source
// compatibility with existing codegen consumers.
export { SCENE_IR_VERSION } from '@lumen/contracts';
export type { IRAssetRef, IRBinding, IRNode, IRTrack, SceneIR } from '@lumen/contracts';

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
    theme: resolveThemeTokens(defaults, config.theme),
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
      if (a.duration !== undefined) ref.duration = a.duration;
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
