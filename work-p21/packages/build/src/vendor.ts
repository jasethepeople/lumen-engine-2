/**
 * @lumen/build — runtime vendoring for the 'static' target.
 *
 * Generated static sites import the bare specifier '@lumen/runtime' (and the
 * runtime transitively imports the other @lumen/* module packages). Because
 * static output is not bundled, the build copies each runtime package's
 * compiled dist into `<outDir>/vendor/<name>/` so the import map emitted by
 * @lumen/codegen (`<script type="importmap">`) resolves to real files.
 *
 * Vendored bytes are deliberately excluded from size budgets (they are the
 * engine runtime, not site content) but included in stale-clean bookkeeping.
 *
 * NOTE: keep `RUNTIME_VENDOR_PACKAGES` in sync with the import map emitted
 * by @lumen/codegen (packages/codegen/src/common.ts).
 */

import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/** Runtime packages reachable from a generated static entry module. */
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
 * Locate the real compiled dist directory for '@lumen/<name>'. The workspace
 * shims in node_modules re-export from the package's dist; follow the
 * re-export so vendored files contain the real modules (relative imports
 * inside dist must keep resolving).
 */
async function resolveDistDir(name: string): Promise<string> {
  const req = createRequire(import.meta.url);
  let shimEntry: string;
  try {
    shimEntry = req.resolve(`@lumen/${name}`);
  } catch {
    throw new Error(
      `build: cannot vendor @lumen/${name} — package is not resolvable from node_modules`,
    );
  }
  const source = await readFile(shimEntry, 'utf8');
  const match = source.match(/from\s+['"]([^'"]+)['"]/);
  if (!match) return dirname(shimEntry); // shim holds real code already
  return resolve(dirname(shimEntry), match[1], '..');
}

/**
 * Copy every runtime package's compiled JS into `<outDir>/vendor/<name>/`.
 * Returns the list of emitted paths relative to outDir (for stale-clean).
 */
export async function vendorRuntimePackages(outDir: string): Promise<string[]> {
  const emitted: string[] = [];
  for (const name of RUNTIME_VENDOR_PACKAGES) {
    const distDir = await resolveDistDir(name);
    const targetDir = join(outDir, 'vendor', name);
    await mkdir(targetDir, { recursive: true });
    await cp(distDir, targetDir, {
      recursive: true,
      filter: (src) => !src.endsWith('.d.ts') && !src.endsWith('.map'),
    });
    // Collect relative paths (JS files only) for the stale-clean keep set.
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
        else if (entry.name.endsWith('.js')) emitted.push(`vendor/${name}/${rel}`);
      }
    };
    await walk(targetDir, '');
  }
  return emitted;
}
