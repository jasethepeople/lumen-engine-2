/**
 * @lumen/config — top-level config parsing entry point.
 *
 * Accepts a raw object or a JSON/JSONC source string, then runs the full
 * pipeline: strip comments → JSON.parse → migrate → validate → defaults.
 */

import type { EngineConfig } from '@lumen/contracts';
import { applyDefaults } from './defaults.js';
import { migrate } from './migrations.js';
import { validateConfig } from './schema.js';
import type { ValidationError } from './validate.js';

/** Final outcome of {@link parseConfig}. */
export type ParseConfigResult =
  | {
      ok: true;
      /** Fully validated config with defaults applied. */
      config: EngineConfig;
      /** Migrations applied during upgrade, in order (e.g. ['0→1', '1→2']). */
      appliedMigrations: string[];
    }
  | {
      ok: false;
      /** Every problem found, with precise JSON paths. */
      errors: ValidationError[];
      /** Migrations applied before validation failed. */
      appliedMigrations: string[];
    };

/**
 * Strips JSONC comments (`//` line and `/* *\/` block) from a string,
 * preserving string literals and character positions (comments become
 * whitespace so JSON.parse error offsets stay meaningful).
 */
export function stripJsonComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const ch = source[i];
    if (inString) {
      out.push(ch);
      if (ch === '\\') {
        if (i + 1 < source.length) out.push(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue; // keep the newline itself
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out.push('\n');
        i++;
      }
      i += 2;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
}

/**
 * Parses, migrates, validates, and applies defaults to an authored config.
 *
 * - `input` may be a plain object or a JSON/JSONC string.
 * - Migration errors (non-object, version gap, too-new version) and JSON
 *   syntax errors are reported as a single error at path `''`.
 */
export function parseConfig(input: unknown | string): ParseConfigResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(stripJsonComments(input));
    } catch (err) {
      return {
        ok: false,
        errors: [{ path: '', message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` }],
        appliedMigrations: [],
      };
    }
  }
  let migrated;
  try {
    migrated = migrate(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: '', message: err instanceof Error ? err.message : String(err) }],
      appliedMigrations: [],
    };
  }
  const validated = validateConfig(migrated.config);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors, appliedMigrations: migrated.appliedMigrations };
  }
  return { ok: true, config: applyDefaults(validated.config), appliedMigrations: migrated.appliedMigrations };
}
