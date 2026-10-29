/**
 * @lumen/codegen — internal shared helpers for target generators.
 * Not part of the public API.
 */

import type {
  AssetManifest,
  CodegenOptions,
  CodegenWarning,
  EngineConfig,
  GeneratedModule,
  ThemeTokens,
} from '@lumen/contracts';
import { toCssVariablesString } from '@lumen/templates';
import { escapeHtml, escapeString, inlineJson, minifySource } from './emit.js';
import { walkIR, type SceneIR } from './ir.js';

/** Shared context handed to each target generator. */
export interface TargetContext {
  config: EngineConfig;
  ir: SceneIR;
  /** Serialized SceneIR (already escaped for inline embedding). */
  irJson: string;
  options: CodegenOptions;
  /** Required runtime capabilities from the TemplateDescriptor. */
  requiredCapabilities: {
    renderers: string[];
    assetFeatures: string[];
    interactions: string[];
  };
  warnings: CodegenWarning[];
  /** P17: optional build-pipeline asset manifest (posters for SSR fallback). */
  manifest?: AssetManifest;
}

/** Byte threshold above which embedded IR JSON earns a warning. */
export const INLINE_JSON_WARN_BYTES = 150_000;

/** Runtime package specifier referenced by all generated entry modules. */
export const RUNTIME_SPECIFIER = '@lumen/runtime';

/**
 * Packages vendored into `<outDir>/vendor/<name>/` by @lumen/build for the
 * 'static' target. NOTE: keep in sync with packages/build/src/vendor.ts.
 */
export const RUNTIME_VENDOR_PACKAGES = [
  'runtime',
  'kernel',
  'scene',
  'rendering',
  'assets',
  'interaction',
  'contracts',
] as const;

/**
 * `<script type="importmap">` mapping the bare `@lumen/*` specifiers used by
 * generated entry modules to their vendored copies. Emitted into static
 * index.html so the site runs unbundled in a browser.
 */
export function importMapScript(): string {
  const imports: Record<string, string> = {};
  for (const name of RUNTIME_VENDOR_PACKAGES) {
    imports[`@lumen/${name}`] = `./vendor/${name}/index.js`;
  }
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`;
}

/** True when the run emits TypeScript sources (per options). */
export function emitTs(options: CodegenOptions): boolean {
  return options.emitTypeScript !== false;
}

/** File extension for emitted JS/TS modules. */
export function moduleExt(options: CodegenOptions): string {
  return emitTs(options) ? '.ts' : '.js';
}

/** TypeScript-only fragment: returns `ts` when emitting TS, '' when emitting JS. */
export function ann(ctx: TargetContext, ts: string): string {
  return emitTs(ctx.options) ? ts : '';
}

/** Push a warning onto the context list. */
export function warn(ctx: TargetContext, code: string, message: string, subject?: string): void {
  const w: CodegenWarning = { code, message };
  if (subject !== undefined) w.subject = subject;
  ctx.warnings.push(w);
}

/**
 * Embed the IR as a `const SCENE_IR = {...}` declaration. Deliberately no
 * `as const`: the literal must stay assignable to mutable runtime params.
 */
export function irDeclaration(ctx: TargetContext): string {
  return `const SCENE_IR = ${ctx.irJson};`;
}

/** Serialize the IR for inline embedding and collect size/asset warnings. */
export function prepareIRJson(config: EngineConfig, ir: SceneIR): { json: string; warnings: CodegenWarning[] } {
  const warnings: CodegenWarning[] = [];
  const raw = JSON.stringify(ir);
  const bytes = raw.length;
  if (bytes > INLINE_JSON_WARN_BYTES) {
    warnings.push({
      code: 'oversized-inline-json',
      message: `Embedded SceneIR is ${bytes} bytes (> ${INLINE_JSON_WARN_BYTES}); consider the 'runtime' target or trimming scenes.`,
      subject: config.id,
    });
  }
  return { json: inlineJson(ir), warnings };
}

/** Cross-check IR asset references against config.assets; warn on gaps. */
export function collectAssetWarnings(config: EngineConfig, ir: SceneIR): CodegenWarning[] {
  const warnings: CodegenWarning[] = [];
  const declared = new Set(config.assets.map((a) => a.id));
  const referenced = new Set<string>();
  walkIR(ir.nodes, (n) => {
    if (n.assetId !== undefined) referenced.add(n.assetId);
  });
  for (const id of referenced) {
    if (!declared.has(id)) {
      warnings.push({
        code: 'missing-asset',
        message: `Scene node references asset '${id}' which is not declared in config.assets.`,
        subject: id,
      });
    }
  }
  for (const a of config.assets) {
    if (!referenced.has(a.id) && a.preload === 'critical') {
      warnings.push({
        code: 'unused-asset',
        message: `Asset '${a.id}' is marked critical but never referenced by any scene node.`,
        subject: a.id,
      });
    }
  }
  return warnings;
}

/** Accessibility gaps worth flagging at generation time. */
export function collectA11yWarnings(config: EngineConfig, ir: SceneIR): CodegenWarning[] {
  const warnings: CodegenWarning[] = [];
  for (const sc of config.scenes) {
    if (!sc.a11y.summary) {
      warnings.push({
        code: 'a11y-missing-summary',
        message: `Scene '${sc.id}' has an a11y label but no summary; screen-reader output will be terse.`,
        subject: sc.id,
      });
    }
  }
  for (const ix of config.interactions) {
    if (!ix.a11yFallback) {
      warnings.push({
        code: 'a11y-missing-fallback',
        message: `Interaction '${ix.id}' declares no a11yFallback for reduced-motion users.`,
        subject: ix.id,
      });
    }
  }
  return warnings;
}

/** Base critical CSS shared by all targets (reset + lumen root scaffold).
 *  Theme variables use the single `--lumen-*` convention owned by
 *  @lumen/templates (`toCssVariablesString`). */
export function criticalCss(theme: ThemeTokens): string {
  return [
    '*,*::before,*::after{box-sizing:border-box}',
    'html,body{margin:0;padding:0}',
    toCssVariablesString(theme),
    // 100vh first, then the dynamic-viewport fallback (iOS URL bar); pan-y
    // keeps vertical touch scrolling native while the virtual scroller tracks it.
    '.lumen-root{min-height:100vh;min-height:100dvh;touch-action:pan-y}',
    '.lumen-scene{position:relative}',
    '.lumen-canvas{display:block;width:100%;height:100%}',
  ].join('\n');
}

/**
 * Build the SSR HTML skeleton for the first scene: dom nodes render their
 * html inline; video-plane/sprite/mesh nodes render poster <img> placeholders.
 *
 * P17: when the build-pipeline `manifest` is provided and the node's asset
 * has a video poster, the placeholder embeds a real
 * `<img data-lumen-poster>` so first paint shows content before the runtime
 * boots (and survives a boot failure, P8). The runtime removes these imgs
 * on its first rendered frame (`render:first-frame`).
 */
export function ssrSkeleton(ir: SceneIR, config: EngineConfig, manifest?: AssetManifest): string {
  const parts: string[] = [];
  const firstScene = config.scenes[0];
  const out: string[] = [];
  const posterFor = (assetId: string | undefined): string | undefined => {
    if (!manifest || !assetId) return undefined;
    const entry = manifest.assets[assetId];
    if (entry && entry.kind === 'video' && entry.poster) return entry.poster;
    return undefined;
  };
  const visitRoots = (nodes: SceneIR['nodes'], depth: number): void => {
    for (const n of nodes) {
      if (!n.visible) continue;
      const pad = '  '.repeat(depth);
      if (n.kind === 'dom' && n.html) {
        out.push(`${pad}<div class="lumen-dom" data-node="${escapeHtml(n.id)}">`);
        out.push(`${pad}  ${n.html}`);
        out.push(`${pad}</div>`);
      } else if (n.kind === 'video-plane' || n.kind === 'sprite' || n.kind === 'mesh') {
        const label = firstScene ? escapeHtml(firstScene.a11y.label) : 'Lumen scene';
        const poster = posterFor(n.assetId);
        const img = poster
          ? `<img data-lumen-poster src="${escapeHtml(poster)}" alt="${label}" loading="eager" decoding="async">`
          : '';
        out.push(
          `${pad}<div class="lumen-spatial" data-node="${escapeHtml(n.id)}" data-asset="${escapeHtml(n.assetId ?? '')}" role="img" aria-label="${label}">${img}</div>`,
        );
      } else {
        out.push(`${pad}<section class="lumen-scene" data-node="${escapeHtml(n.id)}">`);
        visitRoots(n.children, depth + 1);
        out.push(`${pad}</section>`);
      }
    }
  };
  visitRoots(ir.nodes, 2);
  parts.push(out.join('\n'));
  return parts.join('\n');
}

/** `<script type="application/json" id="...">` block with escaped IR JSON. */
export function irScriptTag(ctx: TargetContext, id: string): string {
  return `<script type="application/json" id="${escapeString(id)}">${ctx.irJson}</script>`;
}

/** Apply minification to a generated module when requested. */
export function finalizeModule(mod: GeneratedModule, options: CodegenOptions): GeneratedModule {
  if (!options.target.minify) return mod;
  // Only minify JS-ish modules; leave HTML to the caller's minifier.
  if (mod.path.endsWith('.html') || mod.path.endsWith('.css')) return mod;
  return { ...mod, source: minifySource(mod.source) };
}

/** Collapse whitespace in emitted HTML when minify is on. */
export function minifyHtml(html: string, options: CodegenOptions): string {
  if (!options.target.minify) return html;
  return html
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join('\n');
}
