/**
 * @lumen/app-runtime — app-facing runtime layer.
 *
 * Wraps the engine front half (parseConfig → template composition) with the
 * extended template registry (built-ins + scroll-cinema-landing,
 * cinematic-story, product-showcase) and exposes a small stable contract for
 * app code:
 *
 *   const app = await createLumenApp(configOrJsonOrUrl);
 *   const engine = await app.boot(document.getElementById('root')!);
 *   ...
 *   app.dispose();
 *
 * Input accepted by createLumenApp():
 *   - an EngineConfig-shaped object,
 *   - a JSON/JSONC string (starts with '{'),
 *   - a URL string (fetched, then parsed as JSON).
 *
 * boot() lowers the composed scene to SceneIR via @lumen/codegen lowerToIR
 * and hands it to @lumen/runtime bootEngine — the same seam the root
 * createEngine().boot() uses. boot() requires a DOM (browser); under Node it
 * rejects with bootEngine's guard error. Importing this module under Node is
 * safe: createLumenApp(), listTemplates(), and dispose() all work headless.
 */

import type {
  AssetManifest,
  ComposedScene,
  EngineConfig,
  TemplateKind,
} from '@lumen/contracts';
import { parseConfig } from '@lumen/config';
import {
  cinematicStoryTemplate,
  CINEMATIC_STORY_ID,
  createExtendedRegistry,
  productShowcaseTemplate,
  PRODUCT_SHOWCASE_ID,
  scrollCinemaLandingTemplate,
  SCROLL_CINEMA_LANDING_ID,
  type TemplateRegistry,
} from '@lumen/templates';
import { lowerToIR } from '@lumen/codegen';
import {
  bootEngine,
  manifestFromAssetRefs,
  type BootOptions,
  type LumenEngine,
} from '@lumen/runtime';
import { detectCapabilities } from '@lumen/kernel';

/** A composed, bootable Lumen application. */
export interface LumenApp {
  /** Validated config (defaults applied, migrations run). */
  readonly config: EngineConfig;
  /** The composed scene graph + tracks + bindings. */
  readonly composedScene: ComposedScene;
  /** The asset manifest used for composition. */
  readonly manifest: AssetManifest;
  /**
   * Boot the live engine in a browser against a root element. Rejects under
   * Node (no DOM); call dispose() to tear down every engine booted here.
   */
  boot(rootEl: HTMLElement): Promise<LumenEngine>;
  /** Dispose all engines booted through this app (safe to call repeatedly). */
  dispose(): void;
}

/** Options accepted by createLumenApp(). */
export interface CreateLumenAppOptions {
  /** Template registry override; defaults to createExtendedRegistry(). */
  registry?: TemplateRegistry;
  /**
   * Force reduced-motion behavior for every booted engine (MotionPolicy
   * 'reduced'); default follows the capability profile. Convenience alias
   * for bootOptions.reducedMotion.
   */
  reducedMotion?: boolean;
  /**
   * Extra BootOptions forwarded to bootEngine on every boot(). A precomputed
   * capability profile is always supplied via kernel overrides unless the
   * caller provides one (bootEngine reads capabilities before kernel.start
   * probes them — see BootOptions.kernel).
   */
  bootOptions?: Omit<BootOptions, 'reducedMotion'>;
}

/** Stable descriptor id for a registered template descriptor. */
function descriptorId(d: { kind: TemplateKind }): string {
  if (d === scrollCinemaLandingTemplate) return SCROLL_CINEMA_LANDING_ID;
  if (d === cinematicStoryTemplate) return CINEMATIC_STORY_ID;
  if (d === productShowcaseTemplate) return PRODUCT_SHOWCASE_ID;
  return d.kind;
}

/** List the templates available in the default (extended) registry. */
export function listTemplates(): { kind: TemplateKind; id: string }[] {
  return createExtendedRegistry()
    .list()
    .map((d) => ({ kind: d.kind, id: descriptorId(d) }));
}

/**
 * Resolve the input into a raw config: objects pass through, JSON strings
 * parse inline, anything else string-shaped is treated as a URL and fetched.
 */
async function resolveInput(input: unknown | string): Promise<unknown> {
  if (typeof input !== 'string') return input;
  const trimmed = input.trimStart();
  if (trimmed.startsWith('{')) return input;
  if (typeof fetch !== 'function') {
    throw new Error('@lumen/app-runtime: URL input requires a global fetch() implementation');
  }
  const res = await fetch(input);
  if (!res.ok) {
    throw new Error(`@lumen/app-runtime: failed to fetch config from '${input}' (HTTP ${res.status})`);
  }
  return res.json();
}

/**
 * Create a Lumen app from a config object, JSON string, or config URL.
 * Throws Error with all validation messages when the config is invalid.
 */
export async function createLumenApp(
  input: unknown | string,
  opts: CreateLumenAppOptions = {},
): Promise<LumenApp> {
  const raw = await resolveInput(input);
  const result = parseConfig(raw);
  if (!result.ok) {
    const details = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`createLumenApp: invalid EngineConfig (${result.errors.length} errors)\n${details}`);
  }
  const config = result.config;
  const registry = opts.registry ?? createExtendedRegistry();
  const descriptor = registry.require(config.template);
  const manifest = manifestFromAssetRefs(
    config.assets.map((a) => ({ id: a.id, src: a.src, kind: a.kind, preload: a.preload })),
  );
  const composedScene = descriptor.compose(config, manifest);

  const engines = new Set<LumenEngine>();
  return {
    config,
    composedScene,
    manifest,
    async boot(rootEl) {
      const ir = lowerToIR(config, descriptor.themeTokens, composedScene);
      const bootOpts: BootOptions = {
        // Precompute capabilities: bootEngine reads kernel.capabilities in
        // assets.init before kernel.start() probes them (BOOT_FAILED otherwise).
        ...opts.bootOptions,
        kernel: {
          capabilities:
            opts.bootOptions?.kernel?.capabilities ?? (await detectCapabilities()),
          ...opts.bootOptions?.kernel,
        },
      };
      if (opts.reducedMotion !== undefined) bootOpts.reducedMotion = opts.reducedMotion;
      const engine = await bootEngine(rootEl, ir, bootOpts);
      engines.add(engine);
      return engine;
    },
    dispose() {
      for (const engine of engines) {
        engines.delete(engine);
        void engine.dispose().catch(() => {
          /* best-effort teardown; dispose() is synchronous by contract */
        });
      }
    },
  };
}
