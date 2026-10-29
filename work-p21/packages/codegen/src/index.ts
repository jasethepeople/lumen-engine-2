/**
 * @lumen/codegen — public API.
 *
 * Code generation layer: EngineConfig + ComposedScene (via a TemplateDescriptor
 * from @lumen/templates) -> per-target entry modules, hydration manifest,
 * type declarations, and SSR HTML.
 */

export { generate } from './codegen.js';
export {
  CodeWriter,
  ImportManager,
  SourceFileBuilder,
  escapeHtml,
  escapeString,
  inlineJson,
  isIdentifier,
  minifySource,
  safeIdentifier,
} from './emit.js';
export {
  SCENE_IR_VERSION,
  lowerToIR,
  serializeIR,
  walkIR,
} from './ir.js';
export type { IRAssetRef, IRBinding, IRNode, IRTrack, SceneIR } from './ir.js';
export { generateStatic } from './gen-static.js';
export { generateWebComponent } from './gen-webcomponent.js';
export { generateRuntime } from './gen-runtime.js';
export { generateNpm } from './gen-npm.js';
