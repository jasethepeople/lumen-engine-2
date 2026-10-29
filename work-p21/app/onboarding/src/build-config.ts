/**
 * @lumen/app-onboarding — buildConfig(): assemble a valid EngineConfig
 * from accumulated wizard answers.
 *
 *   - template kind comes from the chosen template (TemplateProvider),
 *   - hero media becomes scene assets + a hero node in the first scene,
 *   - chapters become scenes (scroll-driven tracks, a11y labels),
 *   - the picked theme preset becomes theme color tokens,
 *   - the motion preference maps to each scene's a11y.motion ('inherit'
 *     omits it so the template default applies).
 *
 * The result passes parseConfig() from @lumen/config for every built-in
 * template kind (verified in tests).
 */

import type { EngineConfig, SceneNodeConfig } from '@lumen/contracts';
import { getThemePreset } from '@lumen/app-settings';
import type { TemplateProvider } from './template-provider.js';
import { RuntimeTemplateProvider } from './template-provider.js';
import type { WizardState } from './types.js';

/** Options for buildConfig(). */
export interface BuildConfigOptions {
  /** Template source; defaults to RuntimeTemplateProvider. */
  templateProvider?: TemplateProvider;
  /** Config id; defaults to a generated UUID-ish id. */
  id?: string;
  /** Project title for config.meta; default 'Untitled Lumen Project'. */
  title?: string;
  /** config.meta.description default. */
  description?: string;
  /** config.meta.locale default ('en'). */
  locale?: string;
  /** Default per-chapter track duration/range when not set (default 1000). */
  defaultChapterDuration?: number;
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Assemble an EngineConfig from a wizard state whose required answers are
 * complete (template, hero media, chapters, theme, motion). Throws with a
 * precise message listing what is missing otherwise.
 */
export function buildConfig(
  state: WizardState,
  options: BuildConfigOptions = {},
): EngineConfig {
  const provider = options.templateProvider ?? new RuntimeTemplateProvider();
  const missing: string[] = [];
  const { answers } = state;

  const template = answers.templateId
    ? provider.list().find((t) => t.id === answers.templateId)
    : undefined;
  if (!template) missing.push('template (choose-template)');
  if (answers.heroMedia.length < 1) missing.push('hero media (upload-hero-media)');
  if (answers.chapters.length < 1) missing.push('chapters (define-chapters)');
  const preset = answers.themeId ? getThemePreset(answers.themeId) : undefined;
  if (!preset) missing.push('theme (pick-theme)');
  if (answers.motionPref === undefined) missing.push('motion preference (preview-motion)');

  if (missing.length > 0) {
    throw new Error(`buildConfig: wizard state is incomplete — missing ${missing.join(', ')}`);
  }

  const heroAssets = answers.heroMedia.map((m, i) => ({
    id: `hero-${i}`,
    src: m.name,
    kind: m.kind,
    preload: 'critical' as const,
  }));

  const heroNode: SceneNodeConfig = {
    id: 'hero-media',
    kind: answers.heroMedia[0]!.kind === 'video' ? 'video-plane' : 'sprite',
    assetId: heroAssets[0]!.id,
  };

  const defaultDuration = options.defaultChapterDuration ?? 1000;
  const scenes = answers.chapters.map((chapter, i) => {
    const nodes: SceneNodeConfig[] = [
      ...(i === 0 ? [heroNode] : []),
      {
        id: `${chapter.id}-title`,
        kind: 'dom' as const,
        html: `<h2>${chapter.title}</h2>`,
      },
    ];
    return {
      id: chapter.id,
      slot: i === 0 ? 'hero' : 'chapter',
      nodes,
      track: {
        driver: 'scroll' as const,
        durationOrRange: chapter.duration ?? defaultDuration,
      },
      a11y: {
        label: chapter.title,
        ...(answers.motionPref !== 'inherit' ? { motion: answers.motionPref } : {}),
      },
    };
  });

  return {
    version: 3,
    id: options.id ?? defaultId(),
    template: template!.kind,
    meta: {
      title: options.title ?? 'Untitled Lumen Project',
      description: options.description ?? 'Created with the Lumen onboarding wizard.',
      locale: options.locale ?? 'en',
    },
    theme: {
      colors: {
        'color-bg': preset!.tokens.background,
        'color-surface': preset!.tokens.surface,
        'color-fg': preset!.tokens.text,
        'color-accent': preset!.tokens.accent,
      },
    },
    assets: heroAssets,
    scenes,
    interactions: [],
    build: { target: 'runtime' },
  };
}
