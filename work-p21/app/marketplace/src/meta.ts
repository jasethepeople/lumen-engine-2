/**
 * @lumen/app-marketplace — template metadata model.
 *
 * TemplateMeta is the marketplace-facing description of a template: richer
 * than a contracts-level TemplateDescriptor (which only knows its frozen
 * TemplateKind), it carries discovery metadata (categories, tags, tier,
 * thumbnail), provenance (author, version) and a ready-to-use entryConfig.
 */

import type { EngineConfig, TemplateKind } from '@lumen/contracts';

/** Marketplace category taxonomy (frozen for the marketplace package). */
export type Category =
  | 'landing'
  | 'storytelling'
  | 'product'
  | 'portfolio'
  | 'event'
  | 'experimental';

export const CATEGORIES: readonly Category[] = [
  'landing',
  'storytelling',
  'product',
  'portfolio',
  'event',
  'experimental',
];

/** Pricing tier of a template. */
export type TemplateTier = 'free' | 'pro';

/** Rich registry metadata for one marketplace template. */
export interface TemplateMeta {
  /** Stable unique template id (e.g. 'scroll-cinema-landing'). */
  id: string;
  /** Display name. */
  name: string;
  /** Human-readable description used for search. */
  description: string;
  /** Frozen contracts TemplateKind this template specializes. */
  templateKind: TemplateKind;
  /** Template version (semver, e.g. '1.2.0'). */
  version: string;
  /** Marketplace categories (at least one). */
  categories: Category[];
  /** Free-form discovery tags (lowercase recommended). */
  tags: string[];
  /** Inline data-URI SVG thumbnail; see {@link makeThumbnail}. */
  thumbnail: string;
  /** Pricing tier. */
  tier: TemplateTier;
  /** Author or studio name. */
  author: string;
  /** Minimum engine version required (semver). */
  engineMinVersion: string;
  /** EngineConfig-shaped starter config for this template. */
  entryConfig: EngineConfig;
  /** Optional preview scene count (for cards/listings). */
  previewSceneCount?: number;
}

/** Simple semver check: 'MAJOR.MINOR.PATCH' with optional pre-release/build. */
export function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

/** FNV-1a 32-bit hash — deterministic across runs and platforms. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic placeholder thumbnail: an inline data-URI SVG generated from
 * the template id (same id → same artwork). Two hashed hues drive a diagonal
 * gradient plus a monogram of the id's first character.
 */
export function makeThumbnail(id: string): string {
  const h = fnv1a(id);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >>> 8) % 80)) % 360;
  const letter = (id.trim()[0] ?? '?').toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1},55%,18%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2},65%,42%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#g)"/>` +
    `<text x="160" y="112" font-family="system-ui,sans-serif" font-size="84" ` +
    `font-weight="700" fill="rgba(255,255,255,0.85)" text-anchor="middle">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
