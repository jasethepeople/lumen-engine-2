/**
 * @lumen/build — content hashing and filename/import rewriting.
 *
 * Hashing uses SHA-256 from node:crypto, truncated to a short hex prefix.
 * Import rewriting is intentionally simple and documented: it performs exact
 * string replacement of quoted module specifiers against the known import
 * graph of the CodegenResult (the flattened `importGraph` plus each module's
 * declared `imports`). It does NOT attempt to parse JavaScript; only literal
 * occurrences of `'specifier'` / `"specifier"` / `` `specifier` `` are
 * rewritten, so dynamic or computed specifiers outside the import graph are
 * left untouched by design.
 */

import { createHash } from 'node:crypto';

/** Default length (hex chars) of the truncated content hash used in filenames. */
export const HASH_LENGTH = 10;

/**
 * Compute a deterministic SHA-256 content hash.
 * Returns the first `length` hex characters of the digest.
 */
export function contentHash(content: string | Uint8Array, length: number = HASH_LENGTH): string {
  if (length < 4 || length > 64) {
    throw new RangeError(`hash length must be between 4 and 64, got ${length}`);
  }
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return createHash('sha256').update(data).digest('hex').slice(0, length);
}

/**
 * Insert a content hash into a filename, before the last extension.
 * `'runtime/entry.js'` + hash `'abc123'` -> `'runtime/entry.abc123.js'`.
 * Files without an extension get the hash appended with a dot separator.
 */
export function hashedFilename(path: string, hash: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return `${dir}${base}.${hash}`;
  }
  return `${dir}${base.slice(0, dot)}.${hash}${base.slice(dot)}`;
}

const QUOTES = ['"', "'", '`'] as const;

/**
 * Rewrite quoted module specifiers in emitted JS/HTML source text.
 *
 * For each entry `[from, to]` in `replacements`, every quoted literal
 * occurrence of `from` (`'from'`, `"from"`, `` `from` ``) is replaced with the
 * same-quoted `to`. Unquoted text (identifiers, comments) is never touched.
 * Replacements are applied longest-key-first so that `a/b.js` is rewritten
 * before a hypothetical `a/b` prefix collision.
 *
 * Returns the rewritten source and the number of substitutions performed.
 */
export function rewriteImportPaths(
  source: string,
  replacements: ReadonlyMap<string, string>,
): { source: string; substitutions: number } {
  let result = source;
  let substitutions = 0;
  const ordered = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    if (from === to) continue;
    for (const quote of QUOTES) {
      const needle = `${quote}${from}${quote}`;
      const replacement = `${quote}${to}${quote}`;
      let index = result.indexOf(needle);
      while (index !== -1) {
        result = result.slice(0, index) + replacement + result.slice(index + needle.length);
        substitutions += 1;
        index = result.indexOf(needle, index + replacement.length);
      }
    }
  }
  return { source: result, substitutions };
}
