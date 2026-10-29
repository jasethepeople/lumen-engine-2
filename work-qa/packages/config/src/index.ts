/**
 * @lumen/config — public API.
 *
 * Configuration schema, validation, defaults, and migrations for the
 * Lumen engine. Codegen, Template, and Build agents consume
 * {@link parseConfig} as the single entry point.
 */

export { parseConfig, stripJsonComments, type ParseConfigResult } from './parse.js';
export {
  validateConfig,
  engineConfigSchema,
  CONFIG_VERSION,
  type ConfigValidationOutcome,
} from './schema.js';
export {
  applyDefaults,
  deepMerge,
  DEFAULT_BUILD,
  DEFAULT_PRELOAD_BY_KIND,
  DEFAULT_THEME_TOKENS,
} from './defaults.js';
export { migrate, migrations, type MigrationResult } from './migrations.js';
// Validator combinators (object/string/number/union/...) are internal to the
// schema layer. They remain importable from the internal module
// '@lumen/config' source `validate.js`, but are deliberately not exported from
// the package root (keeps the frozen public surface narrow; avoids the
// `ValidationResult` name collision with @lumen/templates).
export type { ValidationError } from './validate.js';
