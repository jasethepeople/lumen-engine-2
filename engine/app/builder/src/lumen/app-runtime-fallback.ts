/**
 * Local implementation of the `@lumen/app-runtime` contract
 * (Agent A ships the real package in app/runtime).
 *
 * Vite aliases `@lumen/app-runtime` to ../runtime/dist when that dist exists
 * and to this module otherwise (see vite.config.ts). Both expose the same
 * surface, plus one additive option used by the builder preview:
 *
 *   createLumenApp(input, { registry?, reducedMotion? })
 *
 * `reducedMotion` is threaded straight into bootEngine's real v1.1
 * BootOptions.reducedMotion seam (packages/runtime/src/engine.ts), which the
 * MotionPolicy (packages/runtime/src/motion.ts) resolves per boot.
 */

import type { ComposedScene, EngineConfig, TemplateKind } from '@lumen/contracts';
import type { AssetManifest } from '@lumen/contracts';
import type { SceneIR } from '@lumen/codegen';
import type { LumenEngine } from '@lumen/runtime';
import { parseConfig } from '@lumen/config';
import { createExtendedRegistry, TemplateRegistry } from '@lumen/templates';
import { lowerToIR } from '@lumen/codegen';
import { bootEngine, manifestFromAssetRefs } from '@lumen/runtime';
import { detectCapabilities } from '@lumen/kernel';

export interface LumenApp {
  config: EngineConfig;
  composedScene: ComposedScene;
  manifest: AssetManifest;
  boot(rootEl: HTMLElement): Promise<LumenEngine>;
  dispose(): void;
}

export interface CreateLumenAppOptions {
  registry?: TemplateRegistry;
  /** Force reduced-motion behavior in the preview (additive builder option). */
  reducedMotion?: boolean;
}

function resolveRegistry(registry?: TemplateRegistry): TemplateRegistry {
  return registry ?? createExtendedRegistry();
}

/** Parse + compose + lower a config (object or JSON/JSONC string) to SceneIR. */
export function irFromConfig(
  input: unknown | string,
  opts?: CreateLumenAppOptions,
): { config: EngineConfig; ir: SceneIR; composedScene: ComposedScene; manifest: AssetManifest } {
  const parsed = parseConfig(input);
  if (!parsed.ok) {
    const detail = parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
    throw new Error(`Invalid Lumen config:\n${detail}`);
  }
  const config = parsed.config;
  const registry = resolveRegistry(opts?.registry);
  const descriptor = registry.require(config.template);
  const manifest = manifestFromAssetRefs(
    config.assets.map((a) => {
      const ref: { id: string; src: string; kind: EngineConfig['assets'][number]['kind']; preload?: NonNullable<EngineConfig['assets'][number]['preload']>; duration?: number } = {
        id: a.id,
        src: a.src,
        kind: a.kind,
      };
      if (a.preload !== undefined) ref.preload = a.preload;
      if (a.duration !== undefined) ref.duration = a.duration;
      return ref;
    }),
  );
  const composedScene = descriptor.compose(config, manifest);
  const ir = lowerToIR(config, descriptor.themeTokens, composedScene, manifest);
  return { config, ir, composedScene, manifest };
}

export async function createLumenApp(
  input: unknown | string,
  opts?: CreateLumenAppOptions,
): Promise<LumenApp> {
  const { config, ir, composedScene, manifest } = irFromConfig(input, opts);
  let engine: LumenEngine | null = null;
  return {
    config,
    composedScene,
    manifest,
    async boot(rootEl: HTMLElement): Promise<LumenEngine> {
      if (engine) throw new Error('LumenApp.boot() called twice; dispose() first');
      // bootEngine reads kernel.capabilities during assets.init, before
      // kernel.start() probes them — pass a precomputed profile through the
      // real KernelOptions.capabilities seam (designed for exactly this).
      const capabilities = await detectCapabilities();
      engine = await bootEngine(rootEl, ir, {
        kernel: { capabilities },
        // Builder preview contract: the DOM renderer path (WebGL would drop
        // dom/video-plane payloads and is unavailable in many embeds anyway).
        renderer: 'dom',
        ...(opts?.reducedMotion !== undefined ? { reducedMotion: opts.reducedMotion } : {}),
      });
      return engine;
    },
    dispose(): void {
      const e = engine;
      engine = null;
      if (e) void e.dispose();
    },
  };
}

export function listTemplates(): { kind: TemplateKind; id: string }[] {
  return createExtendedRegistry()
    .list()
    .map((d) => ({ kind: d.kind, id: `${d.kind}@${d.version}` }));
}
