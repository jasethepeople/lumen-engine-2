/**
 * Throwing stubs for node builtins that appear in the import graph of
 * browser-consumed packages but whose code paths are NEVER executed in the
 * Builder (CliExecutor / NodeFsSink / vendor pipeline are Node-only).
 * Vite's built-in browser externalization does not provide named exports,
 * which breaks the production bundle, so these stubs satisfy the import
 * graph; calling them is a loud, descriptive error.
 */

function unavailable(name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(
      `${name} is not available in the browser build of the Lumen Builder ` +
        '(this code path requires Node — e.g. CliExecutor, NodeFsSink, @lumen/build pipeline).',
    );
  };
}

// node:child_process
export const spawn = unavailable('node:child_process.spawn');
export const spawnSync = unavailable('node:child_process.spawnSync');
export const execFile = unavailable('node:child_process.execFile');

// node:fs (sync API used by CliExecutor)
export const mkdirSync = unavailable('node:fs.mkdirSync');
export const mkdtempSync = unavailable('node:fs.mkdtempSync');
export const writeFileSync = unavailable('node:fs.writeFileSync');
export const readFileSync = unavailable('node:fs.readFileSync');
export const existsSync = unavailable('node:fs.existsSync');
export const readdirSync = unavailable('node:fs.readdirSync');
export const statSync = unavailable('node:fs.statSync');

// node:fs/promises (used by NodeFsSink / @lumen/build pipeline — Node-only)
export const mkdir = unavailable('node:fs/promises.mkdir');
export const writeFile = unavailable('node:fs/promises.writeFile');
export const readFile = unavailable('node:fs/promises.readFile');
export const readdir = unavailable('node:fs/promises.readdir');
export const rm = unavailable('node:fs/promises.rm');
export const cp = unavailable('node:fs/promises.cp');

// node:os
export const tmpdir = unavailable('node:os.tmpdir');
export const platform = unavailable('node:os.platform');

// node:url
export const fileURLToPath = unavailable('node:url.fileURLToPath');
export const pathToFileURL = unavailable('node:url.pathToFileURL');

// node:module
export const createRequire = unavailable('node:module.createRequire');

export default {};
