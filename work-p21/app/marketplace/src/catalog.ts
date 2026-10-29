/**
 * @lumen/app-marketplace — template catalog.
 *
 * An in-memory catalog fed by pluggable MarketplaceSource implementations
 * (builtin seed data by default; remote/file sources can be added later —
 * sources are async but the marketplace core itself performs no I/O).
 */

import { BUILTIN_TEMPLATES } from './builtin.js';
import { CATEGORIES, type Category, type TemplateMeta, type TemplateTier } from './meta.js';

/** Pluggable catalog source: anything that can list template metadata. */
export interface MarketplaceSource {
  /** Source identifier (for diagnostics/merging). */
  readonly id: string;
  /** Fetch the source's template index. */
  fetchIndex(): Promise<TemplateMeta[]>;
}

/** Source seeded with the engine's built-in template metadata. */
export class BuiltinSource implements MarketplaceSource {
  readonly id = 'builtin';
  fetchIndex(): Promise<TemplateMeta[]> {
    // Defensive copies so callers can never mutate the seed data.
    return Promise.resolve(BUILTIN_TEMPLATES.map((t) => ({ ...t })));
  }
}

/** Optional filters for {@link TemplateCatalog.search}. */
export interface SearchFilters {
  category?: Category;
  tags?: string[];
  tier?: TemplateTier;
}

/** A category with the number of templates in it. */
export interface CategoryCount {
  category: Category;
  count: number;
}

/** Ranking weights: exact tag match > name match > description match. */
const SCORE_TAG_EXACT = 100;
const SCORE_TAG_PARTIAL = 60;
const SCORE_NAME = 40;
const SCORE_DESCRIPTION = 20;

/** Case-insensitive ranking score of a template against a query. */
function scoreTemplate(t: TemplateMeta, q: string): number {
  let score = 0;
  for (const tag of t.tags) {
    const tagLc = tag.toLowerCase();
    if (tagLc === q) {
      score += SCORE_TAG_EXACT;
    } else if (tagLc.includes(q)) {
      score += SCORE_TAG_PARTIAL;
    }
  }
  if (t.name.toLowerCase().includes(q)) score += SCORE_NAME;
  if (t.description.toLowerCase().includes(q)) score += SCORE_DESCRIPTION;
  return score;
}

/**
 * In-memory template catalog. Populate via {@link TemplateCatalog.load}
 * (BuiltinSource by default), then query synchronously.
 */
export class TemplateCatalog {
  private readonly byId = new Map<string, TemplateMeta>();

  constructor(private readonly sources: MarketplaceSource[] = [new BuiltinSource()]) {}

  /** Fetch and merge every source's index (later sources override by id). */
  async load(): Promise<this> {
    for (const source of this.sources) {
      const index = await source.fetchIndex();
      for (const t of index) this.byId.set(t.id, t);
    }
    return this;
  }

  /** Convenience: a loaded catalog from the given (or builtin) sources. */
  static async load(sources?: MarketplaceSource[]): Promise<TemplateCatalog> {
    return new TemplateCatalog(sources).load();
  }

  /** All templates, sorted by id for deterministic iteration. */
  list(): TemplateMeta[] {
    return [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Look up a template by id; undefined when absent. */
  getById(id: string): TemplateMeta | undefined {
    return this.byId.get(id);
  }

  /** Categories with template counts, in taxonomy order (zero-counts omitted). */
  listCategories(): CategoryCount[] {
    const counts = new Map<Category, number>();
    for (const t of this.byId.values()) {
      for (const c of t.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
      category: c,
      count: counts.get(c) ?? 0,
    }));
  }

  /**
   * Case-insensitive search over name, description and tags with optional
   * category/tags/tier filters. Ranking is deterministic: exact tag match
   * outranks name match, which outranks description match; ties break by id.
   * An empty/whitespace query matches everything (filters still apply).
   */
  search(query = '', filters: SearchFilters = {}): TemplateMeta[] {
    const q = query.trim().toLowerCase();
    const wantedTags = filters.tags?.map((t) => t.toLowerCase());
    const results: Array<{ t: TemplateMeta; score: number }> = [];
    for (const t of this.byId.values()) {
      if (filters.category !== undefined && !t.categories.includes(filters.category)) continue;
      if (filters.tier !== undefined && t.tier !== filters.tier) continue;
      if (wantedTags !== undefined && wantedTags.length > 0) {
        const have = new Set(t.tags.map((tag) => tag.toLowerCase()));
        if (!wantedTags.every((tag) => have.has(tag))) continue;
      }
      const score = q === '' ? 0 : scoreTemplate(t, q);
      if (q !== '' && score === 0) continue;
      results.push({ t, score });
    }
    results.sort((a, b) => b.score - a.score || (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0));
    return results.map((r) => r.t);
  }
}
