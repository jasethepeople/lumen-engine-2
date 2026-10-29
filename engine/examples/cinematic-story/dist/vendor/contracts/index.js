/**
 * @lumen/contracts — frozen cross-module contract types for the Lumen engine.
 *
 * This package is orchestrator-owned and frozen. Module agents consume these
 * types via `@lumen/contracts`; do not modify. If a gap is found, implement a
 * local adapter in your module and note it in the module README.
 */
export * from './kernel.js';
export * from './rendering.js';
export * from './scene.js';
export * from './assets.js';
export * from './interaction.js';
export * from './templates.js';
export * from './config.js';
export * from './codegen.js';
export * from './build.js';
export * from './ir.js';
