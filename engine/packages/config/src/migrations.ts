/**
 * @lumen/config — versioned migration runner.
 *
 * A linear registry of pure `ConfigMigration` steps upgrades raw configs
 * from any historical `version` (including pre-versioned v0 documents)
 * to the current schema version. Applied steps are reported so builds can
 * surface deprecation warnings.
 */

import type { ConfigMigration } from '@lumen/contracts';
import { CONFIG_VERSION } from './schema.js';
import { isRecord } from './validate.js';

/**
 * v0 → v1: pre-versioned configs used `site` instead of `id` and had no
 * `interactions` array. Renames the field, seeds an empty binding list.
 */
const migrateV0toV1: ConfigMigration = {
  from: 0,
  to: 1,
  migrate(cfg) {
    const next = { ...cfg };
    if (next.id === undefined && typeof next.site === 'string') {
      next.id = next.site;
      delete next.site;
    }
    if (next.interactions === undefined) next.interactions = [];
    if (next.assets === undefined) next.assets = [];
    next.version = 1;
    return next;
  },
};

/**
 * v1 → v2: scenes used `timeline: { mode, length }`; renamed to the
 * current `track: { driver, durationOrRange }` shape.
 */
const migrateV1toV2: ConfigMigration = {
  from: 1,
  to: 2,
  migrate(cfg) {
    const next = { ...cfg };
    if (Array.isArray(next.scenes)) {
      next.scenes = next.scenes.map((scene) => {
        if (!isRecord(scene) || scene.track !== undefined || !isRecord(scene.timeline)) return scene;
        const { timeline, ...rest } = scene;
        return {
          ...rest,
          track: {
            driver: timeline.mode,
            durationOrRange: timeline.length,
          },
        };
      });
    }
    next.version = 2;
    return next;
  },
};

/**
 * v2 → v3: `output` was renamed to `build` and target names changed
 * (`static-site` → `static`, `web-component` → `webcomponent`,
 * `npm-lib` → `npm`, `runtime-json` → `runtime`).
 */
const migrateV2toV3: ConfigMigration = {
  from: 2,
  to: 3,
  migrate(cfg) {
    const next = { ...cfg };
    const legacy = (next.build ?? next.output) as unknown;
    if (isRecord(legacy)) {
      const rename: Record<string, string> = {
        'static-site': 'static',
        'web-component': 'webcomponent',
        'npm-lib': 'npm',
        'runtime-json': 'runtime',
      };
      const target = typeof legacy.target === 'string' ? (rename[legacy.target] ?? legacy.target) : legacy.target;
      next.build = { ...legacy, target };
    }
    delete next.output;
    next.version = 3;
    return next;
  },
};

/**
 * The linear migration registry, ordered by `from`. Every step must
 * satisfy `to === from + 1`; this is asserted at module load.
 */
export const migrations: readonly ConfigMigration[] = [migrateV0toV1, migrateV1toV2, migrateV2toV3];

for (let i = 0; i < migrations.length; i++) {
  const m = migrations[i];
  if (m.to !== m.from + 1) {
    throw new Error(`migration registry broken: step ${m.from}→${m.to} is not linear`);
  }
  if (i > 0 && m.from !== migrations[i - 1].to) {
    throw new Error(`migration registry broken: gap before step ${m.from}→${m.to}`);
  }
}

/** Result of running migrations over a raw config. */
export interface MigrationResult {
  /** The upgraded raw config (not yet validated). */
  config: Record<string, unknown>;
  /** Ordered list of applied migrations (e.g. ['0→1', '1→2']). */
  appliedMigrations: string[];
}

/**
 * Upgrades a raw config to {@link CONFIG_VERSION}. The source version is
 * read from `version`, defaulting to `0` for pre-versioned documents.
 * Throws on non-object input, gaps in the registry, or a config newer
 * than this runtime understands.
 */
export function migrate(raw: unknown): MigrationResult {
  if (!isRecord(raw)) {
    throw new Error(`cannot migrate config: expected object, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }
  let version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > CONFIG_VERSION) {
    throw new Error(`config version ${version} is newer than supported version ${CONFIG_VERSION}`);
  }
  let config: Record<string, unknown> = { ...raw };
  const appliedMigrations: string[] = [];
  while (version < CONFIG_VERSION) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new Error(`migration gap: no migration from version ${version}`);
    }
    config = step.migrate(config);
    appliedMigrations.push(`${step.from}→${step.to}`);
    version = step.to;
  }
  config.version = CONFIG_VERSION;
  return { config, appliedMigrations };
}
