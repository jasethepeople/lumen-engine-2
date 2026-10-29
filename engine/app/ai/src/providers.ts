/**
 * @lumen/app-ai — provider seam.
 *
 * AIProvider is the single seam through which all AI-assisted features may
 * consult a language model. The shipped default is {@link HeuristicProvider},
 * a fully local keyword/structure-based engine: zero network, zero
 * dependencies, deterministic output. {@link MockAIProvider} is a scripted
 * test double. No implementation in this package performs I/O of any kind.
 */

/** Minimal completion seam: prompt in, text out. */
export interface AIProvider {
  /** Provider identifier (for logging/diagnostics). */
  readonly name: string;
  /** Produce a completion for the given prompt. */
  complete(prompt: string): Promise<string>;
}

/**
 * Deterministic scripted provider for tests and demos.
 *
 * Script forms:
 *  - a single string: returned for every prompt;
 *  - an array of strings: returned in order, cycling when exhausted;
 *  - a record: longest substring key contained in the prompt wins,
 *    falling back to `fallback`.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  private readonly script: string | readonly string[] | Record<string, string>;
  private readonly fallback: string;
  private cursor = 0;

  constructor(script: string | readonly string[] | Record<string, string>, fallback = '') {
    this.script = script;
    this.fallback = fallback;
  }

  complete(prompt: string): Promise<string> {
    const script = this.script;
    if (typeof script === 'string') return Promise.resolve(script);
    if (Array.isArray(script)) {
      const list = script as readonly string[];
      if (list.length === 0) return Promise.resolve(this.fallback);
      const out = list[this.cursor % list.length];
      this.cursor += 1;
      return Promise.resolve(out);
    }
    const table = script as Record<string, string>;
    let best: string | undefined;
    let bestLen = -1;
    for (const key of Object.keys(table)) {
      if (key.length > bestLen && prompt.toLowerCase().includes(key.toLowerCase())) {
        best = table[key];
        bestLen = key.length;
      }
    }
    return Promise.resolve(best ?? this.fallback);
  }
}

/**
 * The default, fully local provider. Extracts structure from the prompt
 * itself (keywords, counts, mood words) and echoes a normalized,
 * deterministic synopsis — never calls the network.
 */
export class HeuristicProvider implements AIProvider {
  readonly name = 'heuristic';

  complete(prompt: string): Promise<string> {
    const text = prompt.trim().replace(/\s+/g, ' ');
    if (!text) return Promise.resolve('');
    const words = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    const freq = new Map<string, number>();
    for (const w of words) {
      if (w.length < 4 || STOP_WORDS.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const keywords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([w]) => w);
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
    const summary = firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
    return Promise.resolve(
      JSON.stringify({ summary, keywords }, null, 0),
    );
  }
}

/** Common English stop words excluded from keyword extraction. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'about', 'with', 'that', 'this', 'from', 'into', 'over', 'under', 'your',
  'their', 'them', 'they', 'then', 'than', 'when', 'where', 'which', 'while',
  'have', 'has', 'had', 'will', 'would', 'could', 'should', 'make', 'made',
  'site', 'page', 'website', 'want', 'need', 'like', 'also', 'each', 'very',
]);
