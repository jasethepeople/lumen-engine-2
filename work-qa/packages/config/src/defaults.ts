/**
 * @lumen/config — defaults applicator.
 *
 * Deep-merges sensible defaults over a validated config: build flags,
 * per-asset preload strategy, and baseline theme tokens. Defaults never
 * override explicitly authored values; merge is per-key, arrays are
 * replaced (not concatenated).
 */

import type { AssetKind, CodegenTarget, EngineConfig, PreloadStrategy, ThemeTokens } from '@lumen/contracts';

/** Default build/codegen option flags (merged under authored `build`). */
export const DEFAULT_BUILD: Required<Omit<CodegenTarget, 'target'>> = {
  minify: true,
  ssr: true,
  moduleFormat: 'esm',
};

/** Baseline theme tokens applied under `config.theme`. */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  colors: {
    'color-bg': '#0b0d10',
    'color-fg': '#f5f7fa',
    'color-accent': '#6aa9ff',
    'color-muted': '#8b93a1',
  },
  typeScale: {
    body: { size: '1rem', lineHeight: 1.5, weight: 400 },
    display: { size: '3rem', lineHeight: 1.1, weight: 700 },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '2rem',
    xl: '4rem',
  },
  motion: {
    standard: [0.2, 0, 0, 1],
    emphasized: [0.3, 0, 0, 1],
    duration: { fast: 150, normal: 300, slow: 600 },
  },
};

/** Heuristic preload strategy per asset kind when not authored. */
export const DEFAULT_PRELOAD_BY_KIND: Record<AssetKind, PreloadStrategy> = {
  image: 'lazy',
  video: 'eager',
  model: 'eager',
  font: 'critical',
  lottie: 'lazy',
  audio: 'lazy',
};

/** Plain-object deep merge: `override` wins per-key; arrays are replaced. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (Array.isArray(override) || Array.isArray(base)) return (override as T) ?? base;
  if (isPlain(base) && isPlain(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(override)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out as T;
  }
  return override as T;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Applies defaults to a validated config (non-destructive; returns a new object):
 * - `config.build` ← DEFAULT_BUILD under authored flags
 * - `config.theme` ← DEFAULT_THEME_TOKENS under authored overrides
 * - each asset's `preload` ← kind heuristic when unset
 */
export function applyDefaults(config: EngineConfig): EngineConfig {
  return {
    ...config,
    build: { ...DEFAULT_BUILD, ...config.build },
    theme: deepMerge(DEFAULT_THEME_TOKENS, config.theme),
    assets: config.assets.map((asset) =>
      asset.preload === undefined
        ? { ...asset, preload: DEFAULT_PRELOAD_BY_KIND[asset.kind] }
        : asset,
    ),
  };
}
