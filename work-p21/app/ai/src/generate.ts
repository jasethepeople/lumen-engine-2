/**
 * @lumen/app-ai — scene generation from free-text descriptions.
 *
 * Builds a complete EngineConfig (v3) using template-informed blueprints:
 * one hero scene (continuous motion) plus chapter scenes (scroll reveal).
 * Every generated config is validated through @lumen/config's parseConfig
 * before being returned; failures throw a typed AIGenerationError.
 */

import type { EngineConfig, SceneConfig, SceneNodeConfig, TemplateKind } from '@lumen/contracts';
import { parseConfig } from '@lumen/config';
import { AIGenerationError } from './errors.js';
import { HeuristicProvider, type AIProvider } from './providers.js';
import {
  MOOD_BLUEPRINTS,
  detectMood,
  extractTitle,
  moodTypeScale,
  type Mood,
} from './analyze.js';
import { suggestChapterStructure } from './chapters.js';

/** Options for {@link generateSceneIRFromDescription}. */
export interface GenerateOptions {
  /** Completion provider; defaults to the local {@link HeuristicProvider}. */
  provider?: AIProvider;
  /** Force a template kind; otherwise inferred from the description. */
  templateKind?: TemplateKind;
  /** Locale for meta.locale (default 'en'). */
  locale?: string;
}

/** Slot + node blueprint per template kind. */
interface TemplateBlueprint {
  heroSlot: string;
  chapterSlot: string;
  heroNodeKind: SceneNodeConfig['kind'];
  heroDriver: SceneConfig['track']['driver'];
  chapterDriver: SceneConfig['track']['driver'];
  /** Asset kind the hero node references, when it is a media node. */
  heroAssetKind?: 'video' | 'model';
}

const BLUEPRINTS: Readonly<Record<TemplateKind, TemplateBlueprint>> = {
  storytelling: {
    heroSlot: 'block',
    chapterSlot: 'block',
    heroNodeKind: 'dom',
    heroDriver: 'time',
    chapterDriver: 'scroll',
  },
  'scroll-video': {
    heroSlot: 'stage',
    chapterSlot: 'caption',
    heroNodeKind: 'video-plane',
    heroDriver: 'scroll',
    chapterDriver: 'scroll',
    heroAssetKind: 'video',
  },
  'cinematic-spa': {
    heroSlot: 'hero',
    chapterSlot: 'gallery',
    heroNodeKind: 'dom',
    heroDriver: 'time',
    chapterDriver: 'time',
  },
  'viewer-3d': {
    heroSlot: 'model',
    chapterSlot: 'hotspot',
    heroNodeKind: 'mesh',
    heroDriver: 'time',
    chapterDriver: 'pointer',
    heroAssetKind: 'model',
  },
};

const TEMPLATE_HINTS: ReadonlyArray<[TemplateKind, readonly string[]]> = [
  ['scroll-video', ['video', 'film', 'footage', 'scroll-video', 'cinematic scroll']],
  ['viewer-3d', ['3d', 'model', 'product viewer', 'webgl', 'three-dimensional']],
  ['cinematic-spa', ['spa', 'app-like', 'gallery', 'cinematic', 'showcase']],
  ['storytelling', ['story', 'storytelling', 'article', 'editorial', 'narrative', 'scrollytelling']],
];

/** Infer a template kind from description keywords (default 'storytelling'). */
export function inferTemplateKind(description: string): TemplateKind {
  const lower = description.toLowerCase();
  for (const [kind, hints] of TEMPLATE_HINTS) {
    if (hints.some((h) => lower.includes(h))) return kind;
  }
  return 'storytelling';
}

function slugify(text: string, fallback: string): string {
  const out = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}

function domNode(id: string, html: string): SceneNodeConfig {
  return { id, kind: 'dom', html };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Generate a validated EngineConfig from a natural-language description.
 *
 * The provider (default: local heuristic) contributes a normalized synopsis
 * that participates in mood/keyword analysis; structure is always derived
 * deterministically so identical inputs produce identical configs.
 */
export async function generateSceneIRFromDescription(
  description: string,
  options: GenerateOptions = {},
): Promise<EngineConfig> {
  const trimmed = description.trim();
  if (!trimmed) {
    throw new AIGenerationError('empty-description', 'cannot generate a scene from an empty description');
  }
  const provider = options.provider ?? new HeuristicProvider();
  let completion = '';
  try {
    completion = await provider.complete(trimmed);
  } catch (err) {
    throw new AIGenerationError(
      'provider-failed',
      `provider '${provider.name}' failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const analysisText = `${trimmed} ${completion}`;

  const templateKind = options.templateKind ?? inferTemplateKind(analysisText);
  const blueprint = BLUEPRINTS[templateKind];
  const mood: Mood = detectMood(analysisText);
  const moodBlueprint = MOOD_BLUEPRINTS[mood];
  const title = extractTitle(trimmed);
  const chapters = suggestChapterStructure(trimmed);
  const siteId = `ai-${slugify(title, 'site').slice(0, 32)}`;

  const assets: EngineConfig['assets'] = [];
  const scenes: SceneConfig[] = [];

  chapters.forEach((chapter, i) => {
    const isHero = i === 0;
    const sceneId = isHero ? 'hero' : slugify(chapter.id, `chapter-${i}`);
    const nodes: SceneNodeConfig[] = [];
    if (isHero && blueprint.heroAssetKind) {
      const assetId = `hero-${blueprint.heroAssetKind}`;
      assets.push({
        id: assetId,
        src: `assets/${assetId}.${blueprint.heroAssetKind === 'video' ? 'mp4' : 'glb'}`,
        kind: blueprint.heroAssetKind,
        preload: 'critical',
      });
      nodes.push({ id: `${sceneId}-media`, kind: blueprint.heroNodeKind, assetId });
      if (templateKind === 'scroll-video') {
        nodes.push(domNode(`${sceneId}-caption`, `<h1>${esc(chapter.title)}</h1>`));
      }
    } else {
      nodes.push(
        isHero
          ? domNode(`${sceneId}-title`, `<h1>${esc(chapter.title)}</h1>`)
          : domNode(`${sceneId}-body`, `<section><h2>${esc(chapter.title)}</h2><p>${esc(chapter.rationale)}</p></section>`),
      );
    }
    scenes.push({
      id: sceneId,
      slot: isHero ? blueprint.heroSlot : blueprint.chapterSlot,
      nodes,
      track: {
        driver: isHero ? blueprint.heroDriver : blueprint.chapterDriver,
        durationOrRange: Math.max(1, chapter.estimatedDuration),
      },
      a11y: {
        label: chapter.title,
        summary: chapter.rationale,
        motion: isHero ? 'continuous' : 'reveal',
      },
    });
  });

  const config: EngineConfig = {
    version: 3,
    id: siteId,
    template: templateKind,
    meta: {
      title,
      description: trimmed.slice(0, 300),
      locale: options.locale ?? 'en',
    },
    theme: {
      colors: { ...moodBlueprint.colors },
      typeScale: moodTypeScale(mood),
      motion: {
        standard: [0.4, 0, 0.2, 1],
        emphasized: [...moodBlueprint.emphasized] as [number, number, number, number],
        duration: { fast: 200, standard: 450, slow: 900 },
      },
    },
    assets,
    scenes,
    interactions: [],
    build: { target: 'static', minify: true, ssr: true, moduleFormat: 'esm' },
  };

  const result = parseConfig(config);
  if (!result.ok) {
    throw new AIGenerationError(
      'validation-failed',
      `generated config failed validation: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      result.errors.map((e) => ({ path: e.path, message: e.message })),
    );
  }
  return result.config;
}
