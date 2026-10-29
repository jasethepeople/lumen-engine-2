/**
 * @lumen/build — per-target emission strategies.
 *
 * Each strategy maps a CodegenResult onto a concrete directory layout for one
 * of the four export targets: 'static' | 'webcomponent' | 'npm' | 'runtime'.
 * Strategies decide the entry file name, the asset subdirectory, which extra
 * files are materialized (SSR shell, type declarations, manifest.json), and
 * the ArtifactFileRole assigned to each emitted file.
 */

import type {
  ArtifactFileRole,
  CodegenResult,
  CodegenTarget,
} from '@lumen/contracts';

export type TargetKind = CodegenTarget['target'];

/** A file planned for emission: output-relative path, content, and metadata. */
export interface PlannedFile {
  /** Output-relative path before content hashing. */
  path: string;
  /** File contents (text). */
  content: string;
  /** Role within the artifact. */
  role: ArtifactFileRole;
  /** Whether the filename should receive a content hash. */
  hashed: boolean;
}

/** Per-target emission strategy. */
export interface TargetStrategy {
  readonly kind: TargetKind;
  /** Subdirectory (relative to outDir) for asset-role files; '' for none. */
  readonly assetsDir: string;
  /** Whether the emitted filenames are content-hashed by default. */
  readonly hashFilenames: boolean;
  /** Whether a manifest.json deploy manifest is emitted. */
  readonly emitManifest: boolean;
  /**
   * Plan the full file list for one CodegenResult: generated modules plus
   * target-specific extras (SSR shell, .d.ts, etc.).
   */
  plan(result: CodegenResult): PlannedFile[];
  /** Entry path (after planning, before hashing) for this target. */
  entryPath(result: CodegenResult): string;
}

function classifyModule(path: string, entry: string): ArtifactFileRole {
  if (path === entry) return 'entry';
  if (/\.(html)$/i.test(path)) return 'ssr';
  if (/\.(worker|worklet)\.[cm]?[jt]s$/i.test(path)) return 'worker';
  if (/\.(png|jpe?g|webp|avif|gif|svg|mp4|webm|m3u8|mp3|woff2?|ttf|otf|glb|gltf|bin|json)$/i.test(path)) {
    return 'asset';
  }
  return 'chunk';
}

function basePlan(
  kind: TargetKind,
  hashFilenames: boolean,
  result: CodegenResult,
  extras: PlannedFile[],
): PlannedFile[] {
  const planned: PlannedFile[] = result.files.map((mod) => ({
    path: mod.path,
    content: mod.source,
    role: classifyModule(mod.path, result.entry),
    hashed: hashFilenames && !/\.html$/i.test(mod.path),
  }));
  return [...planned, ...extras];
}

const staticStrategy: TargetStrategy = {
  kind: 'static',
  assetsDir: 'assets',
  hashFilenames: true,
  emitManifest: true,
  plan(result) {
    const extras: PlannedFile[] = [];
    if (result.ssrHtml) {
      extras.push({ path: 'index.html', content: result.ssrHtml, role: 'ssr', hashed: false });
    }
    return basePlan('static', this.hashFilenames, result, extras);
  },
  entryPath(result) {
    return result.ssrHtml ? 'index.html' : result.entry;
  },
};

const webcomponentStrategy: TargetStrategy = {
  kind: 'webcomponent',
  assetsDir: 'assets',
  hashFilenames: true,
  emitManifest: true,
  plan(result) {
    return basePlan('webcomponent', this.hashFilenames, result, []);
  },
  entryPath(result) {
    return result.entry;
  },
};

const npmStrategy: TargetStrategy = {
  kind: 'npm',
  assetsDir: 'assets',
  hashFilenames: false,
  emitManifest: true,
  plan(result) {
    const extras: PlannedFile[] = [];
    if (result.typeDeclarations) {
      const dts = result.entry.replace(/\.[cm]?js$/i, '.d.ts');
      extras.push({
        path: dts === result.entry ? 'index.d.ts' : dts,
        content: result.typeDeclarations,
        role: 'chunk',
        hashed: false,
      });
    }
    return basePlan('npm', this.hashFilenames, result, extras);
  },
  entryPath(result) {
    return result.entry;
  },
};

const runtimeStrategy: TargetStrategy = {
  kind: 'runtime',
  assetsDir: 'assets',
  hashFilenames: true,
  emitManifest: true,
  plan(result) {
    return basePlan('runtime', this.hashFilenames, result, []);
  },
  entryPath(result) {
    return result.entry;
  },
};

const STRATEGIES: Readonly<Record<TargetKind, TargetStrategy>> = {
  static: staticStrategy,
  webcomponent: webcomponentStrategy,
  npm: npmStrategy,
  runtime: runtimeStrategy,
};

/** Resolve the emission strategy for a target kind. Throws on unknown kinds. */
export function resolveStrategy(kind: TargetKind): TargetStrategy {
  const strategy = STRATEGIES[kind];
  if (!strategy) {
    throw new Error(`Unknown build target: ${String(kind)}`);
  }
  return strategy;
}

/** True when the value is one of the four supported target kinds. */
export function isTargetKind(value: unknown): value is TargetKind {
  return (
    typeof value === 'string' &&
    (value === 'static' || value === 'webcomponent' || value === 'npm' || value === 'runtime')
  );
}
