/**
 * @lumen/app-ai — template recommendation.
 *
 * Ranks marketplace templates against a free-text description or a tag list
 * using keyword overlap over TemplateMeta name/description/tags/categories.
 * Accepts either a TemplateMeta[] array or a catalog exposing
 * `search(query, filters?)` (the @lumen/app-marketplace TemplateCatalog
 * shape) — catalogs are queried with the raw text, then rescored locally.
 */

import type { TemplateMeta } from '@lumen/app-marketplace';
import { tokenize } from './analyze.js';

/** Minimal catalog seam matching TemplateCatalog.search(). */
export interface TemplateCatalogLike {
  search(query?: string, filters?: Record<string, unknown>): TemplateMeta[];
}

/** Input to {@link recommendTemplates}: text or explicit tags. */
export type RecommendationInput = string | { tags: readonly string[] };

/** One ranked recommendation. */
export interface TemplateRecommendation {
  /** TemplateMeta.id. */
  id: string;
  /** Relevance score (higher is better; 0 = no overlap). */
  score: number;
  /** Human-readable explanation of the match. */
  rationale: string;
}

/** Weight per match location. */
const WEIGHTS = { name: 3, tag: 2, category: 2, description: 1 } as const;

/** TemplateKind hint keywords boost matching templates slightly. */
const KIND_HINTS: Readonly<Record<string, readonly string[]>> = {
  'scroll-video': ['video', 'film', 'footage', 'scroll'],
  'viewer-3d': ['3d', 'model', 'product', 'webgl'],
  'cinematic-spa': ['cinematic', 'spa', 'gallery', 'app'],
  storytelling: ['story', 'storytelling', 'editorial', 'narrative', 'article'],
};

function keywordsOf(input: RecommendationInput): string[] {
  if (typeof input === 'string') return [...new Set(tokenize(input))];
  return [...new Set(input.tags.flatMap((t) => tokenize(t)))];
}

function scoreTemplate(meta: TemplateMeta, keywords: readonly string[]): { score: number; hits: string[] } {
  const nameTokens = new Set(tokenize(meta.name));
  const descTokens = new Set(tokenize(meta.description));
  const tagTokens = new Set(meta.tags.flatMap((t) => tokenize(t)));
  const catTokens = new Set(meta.categories.map((c) => c.toLowerCase()));
  let score = 0;
  const hits: string[] = [];
  for (const kw of keywords) {
    if (nameTokens.has(kw)) {
      score += WEIGHTS.name;
      hits.push(`name:${kw}`);
    } else if (tagTokens.has(kw)) {
      score += WEIGHTS.tag;
      hits.push(`tag:${kw}`);
    } else if (catTokens.has(kw)) {
      score += WEIGHTS.category;
      hits.push(`category:${kw}`);
    } else if (descTokens.has(kw)) {
      score += WEIGHTS.description;
      hits.push(`description:${kw}`);
    }
  }
  const kindHints = KIND_HINTS[meta.templateKind] ?? [];
  if (keywords.some((kw) => kindHints.includes(kw))) {
    score += WEIGHTS.tag;
    hits.push(`kind:${meta.templateKind}`);
  }
  return { score, hits };
}

/**
 * Rank templates for the given description/tags. Zero-overlap templates
 * are omitted; ties break by template id for determinism.
 */
export function recommendTemplates(
  input: RecommendationInput,
  catalog: readonly TemplateMeta[] | TemplateCatalogLike,
): TemplateRecommendation[] {
  const keywords = keywordsOf(input);
  let pool: readonly TemplateMeta[];
  if (Array.isArray(catalog)) {
    pool = catalog as readonly TemplateMeta[];
  } else {
    const cat = catalog as TemplateCatalogLike;
    const raw = typeof input === 'string' ? input : keywords.join(' ');
    // Catalogs may do substring (not token) matching; when the raw query
    // matches nothing, fall back to the full catalog and rescore locally.
    const found = cat.search(raw);
    pool = found.length > 0 ? found : cat.search('');
  }
  const ranked: TemplateRecommendation[] = [];
  for (const meta of pool) {
    const { score, hits } = scoreTemplate(meta, keywords);
    if (score <= 0) continue;
    ranked.push({
      id: meta.id,
      score,
      rationale: `Matched ${hits.join(', ')} for '${meta.name}' (${meta.templateKind}).`,
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked;
}
