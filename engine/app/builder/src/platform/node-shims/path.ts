/**
 * Browser shim for the slice of node:path used by @lumen/build's in-memory
 * planning (posix join/dirname/relative/resolve + sep). The publish pipeline
 * only manipulates bundle-relative POSIX paths, so this is a faithful
 * posix-only implementation.
 */

function normalizeSegments(segments: string[]): string {
  const out: string[] = [];
  let absolute = false;
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.startsWith('/')) absolute = true;
    for (const part of seg.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else if (!absolute) out.push('..');
      } else {
        out.push(part);
      }
    }
  }
  const joined = out.join('/');
  return (absolute ? '/' : '') + joined || (absolute ? '/' : '.');
}

export function join(...segments: string[]): string {
  return normalizeSegments(segments);
}

export function resolve(...segments: string[]): string {
  return normalizeSegments(['/', ...segments]);
}

export function dirname(p: string): string {
  const norm = normalizeSegments([p]);
  if (norm === '/' || norm === '.') return norm;
  const idx = norm.lastIndexOf('/');
  if (idx < 0) return '.';
  return idx === 0 ? '/' : norm.slice(0, idx);
}

export function relative(from: string, to: string): string {
  const fromParts = normalizeSegments(['/', from]).split('/').filter(Boolean);
  const toParts = normalizeSegments(['/', to]).split('/').filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const downs = toParts.slice(common);
  const parts = [...Array<string>(ups).fill('..'), ...downs];
  return parts.join('/') || '';
}

export function basename(p: string, ext?: string): string {
  const norm = normalizeSegments([p]);
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

export const sep = '/';
export const delimiter = ':';

export const posix = {
  join,
  resolve,
  dirname,
  relative,
  basename,
  extname,
  sep,
  delimiter,
  normalize: (p: string) => normalizeSegments([p]),
};

export function normalize(p: string): string {
  return normalizeSegments([p]);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export default {
  join,
  resolve,
  dirname,
  relative,
  basename,
  extname,
  sep,
  delimiter,
  posix,
  normalize,
  isAbsolute,
};
