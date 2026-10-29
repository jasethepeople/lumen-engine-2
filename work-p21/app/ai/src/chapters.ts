/**
 * @lumen/app-ai — chapter structure suggestion.
 *
 * Suggests a bounded (1–12) chapter outline either from a free-text
 * description (count + topic keywords) or from an existing EngineConfig
 * (one chapter per scene, preserving ids).
 */

import type { EngineConfig } from '@lumen/contracts';
import { AIGenerationError } from './errors.js';
import { detectChapterCount, extractTitle, tokenize, detectMood } from './analyze.js';

/** Hard bounds for suggested chapter counts. */
export const CHAPTER_BOUNDS = { min: 1, max: 12 } as const;

/** One suggested chapter. */
export interface ChapterSuggestion {
  /** Stable kebab-case id. */
  id: string;
  /** Display title. */
  title: string;
  /** Estimated reading/viewing duration in seconds. */
  estimatedDuration: number;
  /** Why this chapter was suggested. */
  rationale: string;
}

/** Default chapter count when the description mentions none. */
const DEFAULT_CHAPTER_COUNT = 3;

/** Baseline per-chapter duration estimate (seconds). */
const BASE_DURATION_S = 12;

function clampCount(n: number): number {
  return Math.max(CHAPTER_BOUNDS.min, Math.min(CHAPTER_BOUNDS.max, Math.round(n)));
}

/** Suggest chapter topics from the most salient non-stop keywords. */
function chapterTopics(description: string, count: number): string[] {
  const tokens = tokenize(description).filter(
    (t) => t.length >= 4 && !GENERIC_WORDS.has(t),
  );
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      topics.push(t);
    }
    if (topics.length >= count) break;
  }
  return topics;
}

const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'about', 'with', 'that', 'this', 'from', 'into', 'site', 'page', 'website',
  'want', 'need', 'like', 'also', 'each', 'very', 'chapter', 'chapters',
  'section', 'sections', 'scene', 'scenes', 'landing', 'story', 'create',
  'build', 'make', 'showcasing', 'featuring', 'video', 'scrollytelling',
]);

function kebab(input: string): string {
  const out = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'chapter';
}

/**
 * Suggest a chapter structure from a free-text description or an existing
 * EngineConfig. Count always respects {@link CHAPTER_BOUNDS}.
 */
export function suggestChapterStructure(input: string | EngineConfig): ChapterSuggestion[] {
  if (typeof input !== 'string') {
    const cfg = input;
    if (cfg.scenes.length === 0) {
      return suggestChapterStructure(cfg.meta?.description || cfg.meta?.title || 'overview');
    }
    const scenes = cfg.scenes.slice(0, CHAPTER_BOUNDS.max);
    return scenes.map((scene, i) => ({
      id: kebab(scene.id) || `chapter-${i + 1}`,
      title: scene.a11y?.label || scene.id,
      estimatedDuration: estimateSceneDuration(scene.track.durationOrRange),
      rationale: `Derived from existing scene '${scene.id}' (slot '${scene.slot}', driver '${scene.track.driver}').`,
    }));
  }

  const description = input.trim();
  if (!description) {
    throw new AIGenerationError('empty-description', 'cannot suggest chapters from an empty description');
  }
  const mood = detectMood(description);
  const count = clampCount(detectChapterCount(description) ?? DEFAULT_CHAPTER_COUNT);
  const topics = chapterTopics(description, count);
  const siteTitle = extractTitle(description);

  const chapters: ChapterSuggestion[] = [];
  for (let i = 0; i < count; i++) {
    const topic = topics[i];
    const title = i === 0
      ? siteTitle
      : topic
        ? topic[0].toUpperCase() + topic.slice(1)
        : `Chapter ${i + 1}`;
    chapters.push({
      id: i === 0 ? 'hero' : `chapter-${kebab(topic ?? String(i + 1))}`,
      title,
      estimatedDuration: BASE_DURATION_S + (mood === 'energetic' ? -3 : mood === 'calm' ? 4 : 0),
      rationale: i === 0
        ? 'Opening chapter: establishes the hero and sets the tone.'
        : topic
          ? `Topic chapter extracted from the keyword '${topic}' in the description.`
          : `Filler chapter ${i + 1} to reach the requested chapter count.`,
    });
  }
  return chapters;
}

function estimateSceneDuration(durationOrRange: number): number {
  return durationOrRange > 0 ? durationOrRange : BASE_DURATION_S;
}
