/**
 * @lumen/contracts — code generation domain.
 * Output targets, generated modules, and the codegen result contract.
 */

/** The four emission targets supported by codegen. */
export interface CodegenTarget {
  /** Output flavor: static site, Web Component wrapper, npm ESM library, or runtime JSON loader. */
  target: 'static' | 'webcomponent' | 'npm' | 'runtime';
  /** Minify emitted modules. */
  minify?: boolean;
  /** Emit SSR/static HTML shell for DOM regions. */
  ssr?: boolean;
  /** JS module format for emitted chunks. */
  moduleFormat?: 'esm' | 'cjs' | 'iife';
}

/** Options controlling a codegen run. */
export interface CodegenOptions {
  /** Target descriptor. */
  target: CodegenTarget;
  /** Emit TypeScript sources (true) or transpiled JS (false). */
  emitTypeScript?: boolean;
  /** Include sourcemaps. */
  sourcemaps?: boolean;
  /** Optional banner comment prepended to emitted entry modules. */
  banner?: string;
}

/** One generated module: a path plus its source text. */
export interface GeneratedModule {
  /** Output-relative path, e.g. 'runtime/entry.scroll-video.ts'. */
  path: string;
  /** Module source text. */
  source: string;
  /** Module specifiers actually imported (drives bundling/tree-shaking checks). */
  imports: string[];
}

/** One hydration island: a DOM anchor plus the chunk that boots it. */
export interface HydrationIsland {
  /** DOM anchor id. */
  id: string;
  /** Chunk/module to load for this island. */
  module: string;
  /** When hydration starts. */
  trigger: 'eager' | 'visible' | 'interaction';
  /** Serializable props passed to the island. */
  props: Record<string, unknown>;
}

/** Manifest of hydration islands emitted alongside the SSR shell. */
export interface HydrationManifest {
  /** SceneIR schema version the islands were generated from (additive). */
  irVersion?: number;
  /** All islands in document order. */
  islands: HydrationIsland[];
}

/** A non-fatal issue raised during codegen (surfaced in build logs). */
export interface CodegenWarning {
  /** Stable machine-readable code, e.g. 'unused-asset'. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Related config/scene/asset id, when applicable. */
  subject?: string;
}

/** Result of a codegen run over a ComposedScene. */
export interface CodegenResult {
  /** Path of the primary entry module for the target. */
  entry: string;
  /** All generated files: entry modules, hydration manifest, .d.ts, SSR HTML fragments. */
  files: GeneratedModule[];
  /** Hydration manifest (empty when the target does not hydrate). */
  hydrationManifest: HydrationManifest;
  /** Bundled type declarations for the emitted API. */
  typeDeclarations: string;
  /** Pre-rendered SSR HTML shell (empty string when ssr is disabled). */
  ssrHtml: string;
  /** Flattened import graph for bundle analysis. */
  importGraph: string[];
  /** Non-fatal warnings raised during generation. */
  warnings: CodegenWarning[];
}
