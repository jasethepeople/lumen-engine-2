import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveThemeTokens,
  toCssVariables,
  toCssVariablesString,
  SCROLL_VIDEO_THEME_DEFAULTS,
} from '../dist/index.js';

test('resolveThemeTokens merges overrides per-key over defaults', () => {
  const merged = resolveThemeTokens(SCROLL_VIDEO_THEME_DEFAULTS, {
    colors: { accent: '#ff0000' },
    motion: { duration: { fast: 50 } },
  });
  assert.equal(merged.colors.accent, '#ff0000');
  assert.equal(merged.colors.background, '#000000', 'untouched keys keep defaults');
  assert.equal(merged.motion.duration.fast, 50);
  assert.equal(merged.motion.duration.medium, 300);
  assert.deepEqual(merged.motion.standard, SCROLL_VIDEO_THEME_DEFAULTS.motion.standard);
  // Defaults are not mutated.
  assert.notEqual(SCROLL_VIDEO_THEME_DEFAULTS.colors.accent, '#ff0000');
});

test('toCssVariables emits prefixed custom properties', () => {
  const vars = toCssVariables(SCROLL_VIDEO_THEME_DEFAULTS);
  assert.equal(vars['--lumen-color-accent'], '#8ab4ff');
  assert.equal(vars['--lumen-type-body-size'], '1rem');
  assert.equal(vars['--lumen-type-body-line-height'], '1.6');
  assert.equal(vars['--lumen-space-md'], '1rem');
  assert.equal(vars['--lumen-duration-fast'], '150ms');
  assert.equal(vars['--lumen-ease-standard'], 'cubic-bezier(0.4, 0, 0.2, 1)');
  const css = toCssVariablesString(SCROLL_VIDEO_THEME_DEFAULTS);
  assert.ok(css.startsWith(':root {'));
  assert.ok(css.includes('--lumen-color-accent: #8ab4ff;'));
});
