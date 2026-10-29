/**
 * @lumen/app-ai — local text analysis lexicons.
 *
 * Keyword-driven mood/palette/typography extraction shared by scene
 * generation, chapter structuring, and template recommendation.
 * Everything here is deterministic and dependency-free.
 */

import type { CubicBezier, ThemeTokens } from '@lumen/contracts';

/** Recognized mood families. */
export type Mood = 'calm' | 'bold' | 'elegant' | 'energetic' | 'neutral';

/** Mood keyword lexicon (lowercase, matched on word stems). */
export const MOOD_KEYWORDS: Readonly<Record<Mood, readonly string[]>> = {
  calm: ['calm', 'serene', 'minimal', 'quiet', 'soft', 'gentle', 'peaceful', 'soothing', 'meditative', 'airy'],
  bold: ['bold', 'striking', 'loud', 'dramatic', 'impactful', 'strong', 'brutal', 'daring'],
  elegant: ['elegant', 'luxury', 'premium', 'refined', 'sophisticated', 'classy', 'sleek', 'polished'],
  energetic: ['energetic', 'vibrant', 'playful', 'dynamic', 'electric', 'exciting', 'fast', 'punchy', 'neon'],
  neutral: [],
};

/** Palette + motion signature per mood (CSS colors, valid per config schema). */
export interface MoodBlueprint {
  colors: Record<string, string>;
  emphasized: CubicBezier;
  /** Preferred type weight for display steps. */
  displayWeight: number;
}

export const MOOD_BLUEPRINTS: Readonly<Record<Mood, MoodBlueprint>> = {
  calm: {
    colors: {
      background: '#f7f5f0',
      foreground: '#2e3238',
      accent: '#7fa6a0',
      muted: '#c9c4bb',
    },
    emphasized: [0.22, 0.61, 0.36, 1],
    displayWeight: 500,
  },
  bold: {
    colors: {
      background: '#0d0d0f',
      foreground: '#f5f2ea',
      accent: '#ff4d2e',
      muted: '#3a3a40',
    },
    emphasized: [0.83, 0, 0.17, 1],
    displayWeight: 800,
  },
  elegant: {
    colors: {
      background: '#101216',
      foreground: '#ece7dd',
      accent: '#c9a86a',
      muted: '#4a4e57',
    },
    emphasized: [0.16, 1, 0.3, 1],
    displayWeight: 600,
  },
  energetic: {
    colors: {
      background: '#12061f',
      foreground: '#fdfcff',
      accent: '#23e6c1',
      muted: '#43295e',
    },
    emphasized: [0.5, 1.6, 0.4, 0.9],
    displayWeight: 700,
  },
  neutral: {
    colors: {
      background: '#ffffff',
      foreground: '#1a1d21',
      accent: '#3d6fe0',
      muted: '#e3e6ea',
    },
    emphasized: [0.22, 0.61, 0.36, 1],
    displayWeight: 600,
  },
};

/** Typography scale template; display weight is set from the mood. */
export function moodTypeScale(mood: Mood): ThemeTokens['typeScale'] {
  const weight = MOOD_BLUEPRINTS[mood].displayWeight;
  return {
    display: { size: '3.5rem', lineHeight: 1.05, weight },
    heading: { size: '2rem', lineHeight: 1.2, weight: Math.max(400, weight - 100) },
    body: { size: '1rem', lineHeight: 1.6, weight: 400 },
    caption: { size: '0.8125rem', lineHeight: 1.4, weight: 400 },
  };
}

/** Detect the dominant mood in free text (first match wins by lexicon order). */
export function detectMood(text: string): Mood {
  const lower = text.toLowerCase();
  let best: Mood = 'neutral';
  let bestHits = 0;
  for (const mood of ['calm', 'bold', 'elegant', 'energetic'] as const) {
    const hits = MOOD_KEYWORDS[mood].reduce(
      (n, kw) => n + (lower.includes(kw) ? 1 : 0),
      0,
    );
    if (hits > bestHits) {
      best = mood;
      bestHits = hits;
    }
  }
  return best;
}

/**
 * Detect an explicitly mentioned chapter/section count, e.g. "5 chapters",
 * "three sections". Returns undefined when no count is mentioned.
 */
export function detectChapterCount(text: string): number | undefined {
  const lower = text.toLowerCase();
  const numeric = lower.match(/(\d{1,2})\s*(?:chapters?|sections?|scenes?|parts?|steps?)\b/);
  if (numeric) return Number.parseInt(numeric[1], 10);
  const words = lower.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:chapters?|sections?|scenes?|parts?|steps?)\b/,
  );
  if (words) {
    const table: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    };
    return table[words[1]];
  }
  return undefined;
}

/** Extract a compact title from a description (first clause, title-cased-ish). */
export function extractTitle(description: string): string {
  const first = description.trim().split(/(?<=[.!?\n])\s*/)[0] ?? description.trim();
  const cleaned = first.replace(/^(?:create|build|make|design|generate)\s+(?:a|an|the|me)?\s*/i, '');
  const trimmed = cleaned.replace(/[.!?\s]+$/, '');
  const title = trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}...` : trimmed;
  return title.length > 0 ? title[0].toUpperCase() + title.slice(1) : 'Untitled Site';
}

/** Tokenize text into lowercase word tokens (letters/digits, len >= 2). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g)?.filter((t) => t.length >= 2) ?? [];
}
