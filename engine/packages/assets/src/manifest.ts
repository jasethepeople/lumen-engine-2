/**
 * Asset manifest validation, normalization, and URL resolution.
 *
 * The manifest is emitted at build time (see @lumen/build) and consumed at
 * runtime by the preload executor and cache. This module is pure and
 * dependency-free so it can run in Node and the browser alike.
 */
import type {
  AssetEntry,
  AssetKind,
  AssetManifest,
  PreloadStrategy,
} from '@lumen/contracts';

/** Error thrown when a manifest fails validation. */
export class ManifestError extends Error {
  override readonly name = 'ManifestError';
}

const KINDS: readonly AssetKind[] = ['image', 'video', 'model', 'font', 'lottie', 'audio'];
const PRIORITIES: readonly PreloadStrategy[] = ['critical', 'eager', 'lazy'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, reason: string): never {
  throw new ManifestError(`Invalid asset manifest at ${path}: ${reason}`);
}

function validateEntry(id: string, entry: unknown): AssetEntry {
  const path = `assets["${id}"]`;
  if (!isRecord(entry)) fail(path, 'entry must be an object');
  if (typeof entry['kind'] !== 'string' || !KINDS.includes(entry['kind'] as AssetKind)) {
    fail(path, `kind must be one of ${KINDS.join(', ')}`);
  }
  if (entry['id'] !== undefined && entry['id'] !== id) {
    fail(path, `entry.id "${String(entry['id'])}" does not match manifest key "${id}"`);
  }
  if (
    typeof entry['preload'] !== 'string' ||
    !PRIORITIES.includes(entry['preload'] as PreloadStrategy)
  ) {
    fail(path, `preload must be one of ${PRIORITIES.join(', ')}`);
  }
  if (typeof entry['bytes'] !== 'number' || entry['bytes'] < 0) {
    fail(path, 'bytes must be a non-negative number');
  }

  switch (entry['kind'] as AssetKind) {
    case 'image': {
      const v = entry['variants'];
      if (!isRecord(v) || !isRecord(v['fallback']) || typeof v['fallback']['url'] !== 'string') {
        fail(path, 'image entries require variants.fallback.url');
      }
      break;
    }
    case 'video': {
      const v = entry['variants'];
      if (!isRecord(v)) fail(path, 'video entries require variants');
      if (typeof entry['poster'] !== 'string') fail(path, 'video entries require poster');
      if (!isRecord(v['hls']) && !isRecord(v['mp4']) && !isRecord(v['webm'])) {
        fail(path, 'video entries require at least one of hls/mp4/webm variants');
      }
      for (const key of ['mp4', 'webm'] as const) {
        const variant = v[key];
        if (variant !== undefined && (!isRecord(variant) || typeof variant['url'] !== 'string')) {
          fail(path, `video variant '${key}' requires a string url`);
        }
      }
      const hls = v['hls'];
      if (hls !== undefined && (!isRecord(hls) || typeof hls['playlist'] !== 'string')) {
        fail(path, "video variant 'hls' requires a string playlist");
      }
      if (
        typeof entry['duration'] !== 'number' ||
        !Number.isFinite(entry['duration']) ||
        entry['duration'] < 0
      ) {
        fail(path, 'video entries require a finite duration >= 0');
      }
      break;
    }
    case 'model':
    case 'font':
    case 'lottie': {
      if (typeof entry['url'] !== 'string') fail(path, `${entry['kind']} entries require url`);
      break;
    }
    case 'audio': {
      const v = entry['variants'];
      if (!isRecord(v) || (!isRecord(v['aac']) && !isRecord(v['opus']))) {
        fail(path, 'audio entries require an aac and/or opus variant');
      }
      break;
    }
  }
  return entry as unknown as AssetEntry;
}

/**
 * Validate a manifest payload and return a normalized copy: entries are keyed
 * by id with `entry.id` filled in from the key, assets are sorted by
 * (priority, id) is NOT applied here — ordering concerns live in preload.ts.
 */
export function normalizeManifest(input: unknown): AssetManifest {
  if (!isRecord(input)) fail('$', 'manifest must be an object');
  if (input['version'] !== 1) fail('version', 'only manifest version 1 is supported');
  if (typeof input['generatedAt'] !== 'string') fail('generatedAt', 'must be an ISO-8601 string');
  if (!isRecord(input['assets'])) fail('assets', 'must be a record of entries');

  const assets: Record<string, AssetEntry> = Object.create(null) as Record<string, AssetEntry>;
  for (const [id, raw] of Object.entries(input['assets'])) {
    const entry = validateEntry(id, raw);
    assets[id] = { ...entry, id };
  }
  return {
    version: 1,
    generatedAt: input['generatedAt'],
    assets,
  };
}

/** True when the payload validates as a v1 manifest. */
export function isAssetManifest(input: unknown): input is AssetManifest {
  try {
    normalizeManifest(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a manifest-relative URL against an optional CDN base. Absolute
 * URLs (http(s)://, protocol-relative, data:, blob:) pass through untouched.
 */
export function resolveAssetUrl(url: string, cdnBase?: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^(?:data|blob):/i.test(url)) {
    return url;
  }
  if (!cdnBase) return url;
  const base = cdnBase.endsWith('/') ? cdnBase.slice(0, -1) : cdnBase;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}

/**
 * Group manifest asset ids by preload priority, in load order
 * (critical first). Ids within a group are sorted for determinism.
 */
export function groupByPriority(manifest: AssetManifest): Record<PreloadStrategy, string[]> {
  const groups: Record<PreloadStrategy, string[]> = { critical: [], eager: [], lazy: [] };
  for (const [id, entry] of Object.entries(manifest.assets)) {
    groups[entry.preload].push(id);
  }
  for (const list of Object.values(groups)) list.sort();
  return groups;
}

/** Primary transferable URL for an entry (used for cache keys and fetch). */
export function primaryUrl(entry: AssetEntry): string {
  switch (entry.kind) {
    case 'image':
      return entry.variants.fallback.url;
    case 'video':
      return (
        entry.variants.mp4?.url ?? entry.variants.webm?.url ?? entry.variants.hls?.playlist ?? entry.poster
      );
    case 'model':
    case 'font':
    case 'lottie':
      return entry.url;
    case 'audio':
      return entry.variants.opus?.url ?? entry.variants.aac?.url ?? '';
  }
}

/**
 * Derive a stable content-hash key for an entry. Hash-addressed CDN layouts
 * (`/assets/<hash>/<name>.<ext>`) embed the hash in the URL path; when no
 * hash segment is present we fall back to the full primary URL + byte size.
 */
export function contentHashKey(entry: AssetEntry): string {
  const url = primaryUrl(entry);
  const match = /\/assets\/([0-9a-f]{8,64})\//i.exec(url);
  const hash = match?.[1] ?? `${url}#${entry.bytes}`;
  return `${entry.kind}:${hash}`;
}
