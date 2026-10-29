/**
 * lumen-engine — single entry point.
 *
 * Re-exports the public API of every module package plus a createEngine()
 * convenience that runs the whole front half of the pipeline:
 *
 *   parseConfig(configInput) → registry lookup → descriptor.compose()
 *   → { composedScene, manifest, boot(rootEl), build(target) }
 */

export * from '@lumen/contracts';
export * from '@lumen/kernel';
export * from '@lumen/scene';
export * from '@lumen/rendering';
export * from '@lumen/assets';
export * from '@lumen/interaction';
export * from '@lumen/templates';   // full surface again (incl. theme helpers, registry)
// Explicit (no `export *`): config's validator combinators are internal-only,
// so the public surface is listed by name to keep it frozen and narrow.
export { parseConfig, stripJsonComments, validateConfig, engineConfigSchema, CONFIG_VERSION,
         applyDefaults, deepMerge, DEFAULT_BUILD, DEFAULT_PRELOAD_BY_KIND, DEFAULT_THEME_TOKENS,
         migrate, migrations } from '@lumen/config';
export type { ParseConfigResult, ConfigValidationOutcome, MigrationResult, ValidationError } from '@lumen/config';
export * from '@lumen/codegen';
export * from '@lumen/build';
// Explicit (no `export *`): the SceneIR types already arrive via contracts and
// codegen (same symbols); only runtime's behavior functions are listed here.
export { bootEngine, hydrateIslands, parseSceneIR, asKernelHandle,
         composedSceneFromIR, isSceneIR, manifestFromAssetRefs } from '@lumen/runtime';
export type { BootOptions, LumenEngine } from '@lumen/runtime';

import type {
  AssetManifest,
  BuildArtifact,
  CodegenTarget,
  ComposedScene,
  EngineConfig,
} from '@lumen/contracts';
import { parseConfig, type ParseConfigResult } from '@lumen/config';
import { createDefaultRegistry, type TemplateRegistry } from '@lumen/templates';
import { generate, lowerToIR } from '@lumen/codegen';
import { build as runBuild } from '@lumen/build';
import { bootEngine, manifestFromAssetRefs, type LumenEngine } from '@lumen/runtime';

/** Options for createEngine(). */
export interface CreateEngineOptions {
  /** Pre-built template registry (defaults to the four built-in templates). */
  registry?: TemplateRegistry;
  /**
   * Asset manifest handed to template composition. Default: a minimal
   * manifest synthesized from `config.assets` (see manifestFromAssetRefs).
   */
  manifest?: AssetManifest;
  /** Extra codegen/build flags merged into the target descriptor. */
  build?: Partial<CodegenTarget>;
  /** Sink for the human-readable build report. */
  onReport?: (text: string) => void;
}

/** A composed, bootable/buildable engine descriptor. */
export interface EngineDescriptor {
  /** Validated config (defaults applied, migrations run). */
  readonly config: EngineConfig;
  /** Which config migrations were applied while parsing. */
  readonly appliedMigrations: readonly string[];
  /** The composed scene graph + tracks + bindings. */
  readonly composedScene: ComposedScene;
  /** The asset manifest used for composition. */
  readonly manifest: AssetManifest;
  /** Boot the live engine in a browser against a root element. */
  boot(rootEl: HTMLElement): Promise<LumenEngine>;
  /** Run codegen + the build pipeline for one target; returns the artifact. */
  build(target?: Partial<CodegenTarget> & { outDir?: string }): Promise<BuildArtifact>;
}

/**
 * Parse an EngineConfig (object or JSON/JSONC string), compose it through its
 * template, and return a descriptor that can boot in the browser or build to
 * a deployable artifact. Throws Error with all validation messages when the
 * config is invalid.
 */
export function createEngine(
  configInput: Parameters<typeof parseConfig>[0],
  options: CreateEngineOptions = {},
): EngineDescriptor {
  const result: ParseConfigResult = parseConfig(configInput);
  if (!result.ok) {
    const details = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`createEngine: invalid EngineConfig (${result.errors.length} errors)\n${details}`);
  }
  const config = result.config;
  const registry = options.registry ?? createDefaultRegistry();
  const descriptor = registry.require(config.template);
  const manifest =
    options.manifest ??
    manifestFromAssetRefs(
      config.assets.map((a) => ({ id: a.id, src: a.src, kind: a.kind, preload: a.preload })),
    );
  const composedScene = descriptor.compose(config, manifest);

  return {
    config,
    appliedMigrations: result.appliedMigrations,
    composedScene,
    manifest,
    boot(rootEl) {
      const ir = lowerToIR(config, descriptor.themeTokens, composedScene);
      return bootEngine(rootEl, ir);
    },
    async build(target = {}) {
      const { outDir = 'dist', ...targetOverrides } = target;
      const codegenTarget: CodegenTarget = { ...config.build, ...options.build, ...targetOverrides };
      const artifact = await runBuild(
        { target: codegenTarget, outDir, onReport: options.onReport },
        (codegenOptions) => generate(config, descriptor, composedScene, codegenOptions),
      );
      return artifact;
    },
  };
}
