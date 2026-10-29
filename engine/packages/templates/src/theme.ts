/**
 * @lumen/templates — theme token resolution.
 * Merges EngineConfig.theme overrides over template defaults and emits
 * CSS custom properties for DOM regions.
 */

import type { ThemeTokens, TypeScaleStep } from '@lumen/contracts';

/** Shallow record merge: override keys win; missing keys fall back to base. */
function mergeRecords<T>(base: Record<string, T>, over: Record<string, T> | undefined): Record<string, T> {
  if (!over) return { ...base };
  const out: Record<string, T> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Resolve final theme tokens by merging config overrides over template defaults.
 * `colors`, `typeScale`, `spacing`, and `motion.duration` merge per-key;
 * `motion.standard` / `motion.emphasized` replace atomically when provided.
 */
export function resolveThemeTokens(defaults: ThemeTokens, overrides: Partial<ThemeTokens> | undefined): ThemeTokens {
  const over = overrides ?? {};
  const motionOver = over.motion;
  return {
    colors: mergeRecords(defaults.colors, over.colors),
    typeScale: mergeRecords<TypeScaleStep>(defaults.typeScale, over.typeScale),
    spacing: mergeRecords(defaults.spacing, over.spacing),
    motion: {
      standard: motionOver?.standard ?? [...defaults.motion.standard] as ThemeTokens['motion']['standard'],
      emphasized: motionOver?.emphasized ?? [...defaults.motion.emphasized] as ThemeTokens['motion']['emphasized'],
      duration: mergeRecords(defaults.motion.duration, motionOver?.duration),
    },
  };
}

/**
 * Emit CSS custom properties from resolved tokens, prefixed with `--lumen-`.
 * Colors: `--lumen-color-<key>`; type: `--lumen-type-<step>-{size,line-height,weight}`;
 * spacing: `--lumen-space-<key>`; motion durations: `--lumen-duration-<key>`;
 * easing curves: `--lumen-ease-standard` / `--lumen-ease-emphasized` as cubic-bezier().
 */
export function toCssVariables(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens.colors)) {
    vars[`--lumen-color-${name}`] = value;
  }
  for (const [step, t] of Object.entries(tokens.typeScale)) {
    vars[`--lumen-type-${step}-size`] = t.size;
    vars[`--lumen-type-${step}-line-height`] = String(t.lineHeight);
    vars[`--lumen-type-${step}-weight`] = String(t.weight);
  }
  for (const [name, value] of Object.entries(tokens.spacing)) {
    vars[`--lumen-space-${name}`] = value;
  }
  for (const [name, ms] of Object.entries(tokens.motion.duration)) {
    vars[`--lumen-duration-${name}`] = `${ms}ms`;
  }
  const bezier = (b: ThemeTokens['motion']['standard']): string => `cubic-bezier(${b.join(', ')})`;
  vars['--lumen-ease-standard'] = bezier(tokens.motion.standard);
  vars['--lumen-ease-emphasized'] = bezier(tokens.motion.emphasized);
  return vars;
}

/** Serialize CSS variables to an inline `:root { ... }` block string. */
export function toCssVariablesString(tokens: ThemeTokens): string {
  const lines = Object.entries(toCssVariables(tokens)).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Shared default type scale used by all four templates. */
export function defaultTypeScale(): ThemeTokens['typeScale'] {
  return {
    caption: { size: '0.875rem', lineHeight: 1.4, weight: 400 },
    body: { size: '1rem', lineHeight: 1.6, weight: 400 },
    title: { size: '1.75rem', lineHeight: 1.25, weight: 600 },
    display: { size: '3rem', lineHeight: 1.1, weight: 700 },
  };
}

/** Shared default spacing scale. */
export function defaultSpacing(): ThemeTokens['spacing'] {
  return { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '2rem', xl: '4rem' };
}

/** Shared default motion tokens. */
export function defaultMotion(): ThemeTokens['motion'] {
  return {
    standard: [0.4, 0, 0.2, 1],
    emphasized: [0.2, 0, 0, 1],
    duration: { fast: 150, medium: 300, slow: 600 },
  };
}
