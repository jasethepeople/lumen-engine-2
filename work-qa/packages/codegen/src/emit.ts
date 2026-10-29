/**
 * @lumen/codegen — tiny code-emission toolkit.
 *
 * Deliberately dependency-free (no ts-morph): an indented writer, an import
 * statement manager with dedupe/sort, safe identifier escaping, and a
 * source-file builder producing GeneratedModule-shaped output. Node- and
 * browser-safe.
 */

import type { GeneratedModule } from '@lumen/contracts';

/** A line-oriented writer that manages indentation. */
export class CodeWriter {
  private lines: string[] = [];
  private depth = 0;

  /** Increase the indent depth. Returns `this` for chaining. */
  indent(): this {
    this.depth += 1;
    return this;
  }

  /** Decrease the indent depth (clamped at 0). Returns `this` for chaining. */
  dedent(): this {
    this.depth = Math.max(0, this.depth - 1);
    return this;
  }

  /** Append one or more lines at the current indent. Empty strings stay empty. */
  line(text = ''): this {
    if (text === '') {
      this.lines.push('');
      return this;
    }
    for (const part of text.split('\n')) {
      this.lines.push(part === '' ? '' : '  '.repeat(this.depth) + part);
    }
    return this;
  }

  /** Append a block: `header {`, indented body via callback, `}`. */
  block(header: string, body: (w: CodeWriter) => void, closer = '}'): this {
    this.line(`${header} {`);
    this.indent();
    body(this);
    this.dedent();
    this.line(closer);
    return this;
  }

  /** Current line count. */
  get size(): number {
    return this.lines.length;
  }

  /** Join all lines into the final source text (trailing newline). */
  toString(): string {
    return this.lines.join('\n') + '\n';
  }
}

/**
 * Import statement manager. Deduplicates specifiers per module and emits
 * import statements sorted by specifier then by imported name.
 */
export class ImportManager {
  private named = new Map<string, Set<string>>();
  private defaults = new Map<string, string>();
  private namespaces = new Map<string, string>();
  private sideEffect = new Set<string>();

  /** Add a named import: `import { a, b } from 'spec'`. */
  add(specifier: string, ...names: string[]): this {
    let set = this.named.get(specifier);
    if (!set) {
      set = new Set();
      this.named.set(specifier, set);
    }
    for (const n of names) set.add(n);
    return this;
  }

  /** Add a default import: `import name from 'spec'`. */
  addDefault(specifier: string, localName: string): this {
    const prev = this.defaults.get(specifier);
    if (prev && prev !== localName) {
      throw new Error(
        `Conflicting default imports for '${specifier}': '${prev}' vs '${localName}'`,
      );
    }
    this.defaults.set(specifier, localName);
    return this;
  }

  /** Add a namespace import: `import * as name from 'spec'`. */
  addNamespace(specifier: string, localName: string): this {
    const prev = this.namespaces.get(specifier);
    if (prev && prev !== localName) {
      throw new Error(
        `Conflicting namespace imports for '${specifier}': '${prev}' vs '${localName}'`,
      );
    }
    this.namespaces.set(specifier, localName);
    return this;
  }

  /** Add a side-effect import: `import 'spec'`. */
  addSideEffect(specifier: string): this {
    this.sideEffect.add(specifier);
    return this;
  }

  /** All module specifiers actually imported (sorted, deduped). */
  specifiers(): string[] {
    const all = new Set<string>([
      ...this.named.keys(),
      ...this.defaults.keys(),
      ...this.namespaces.keys(),
      ...this.sideEffect,
    ]);
    return [...all].sort();
  }

  /** Render the import block (empty string when there are no imports). */
  render(): string {
    const w = new CodeWriter();
    const specs = this.specifiers();
    for (const spec of specs) {
      const parts: string[] = [];
      const def = this.defaults.get(spec);
      if (def) parts.push(def);
      const ns = this.namespaces.get(spec);
      if (ns) parts.push(`* as ${ns}`);
      const named = this.named.get(spec);
      if (named && named.size > 0) parts.push(`{ ${[...named].sort().join(', ')} }`);
      if (parts.length === 0) {
        w.line(`import '${escapeString(spec)}';`);
      } else {
        w.line(`import ${parts.join(', ')} from '${escapeString(spec)}';`);
      }
    }
    const out = w.toString();
    return out === '\n' ? '' : out;
  }
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Reserved words that cannot be used as plain identifiers. */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'let', 'static', 'implements', 'interface',
  'package', 'private', 'protected', 'public', 'await',
]);

/** True when `name` is a safe, unreserved JS identifier. */
export function isIdentifier(name: string): boolean {
  return IDENT_RE.test(name) && !RESERVED.has(name);
}

/**
 * Coerce an arbitrary string into a safe JS identifier. Replaces invalid
 * characters with `_`, prefixes digits, and de-reserves keywords.
 */
export function safeIdentifier(raw: string): string {
  let id = raw.replace(/[^A-Za-z0-9_$]/g, '_');
  if (id === '') id = '_';
  if (/^[0-9]/.test(id)) id = `_${id}`;
  if (RESERVED.has(id)) id = `${id}_`;
  return id;
}

/** Escape a string for embedding inside a single-quoted JS/TS string literal. */
export function escapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/&/g, '\\x26')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Serialize a value as a JS literal safe for inline `<script>` embedding. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Escape text for embedding in HTML text/attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds one generated source file: a banner, an import block (rendered at
 * finalize time so imports can be added while writing the body), then the body.
 */
export class SourceFileBuilder {
  readonly imports = new ImportManager();
  private header: string[] = [];
  private body = new CodeWriter();

  constructor(readonly path: string) {}

  /** Prepend a comment banner line (before imports). */
  bannerLine(text: string): this {
    this.header.push(`// ${text}`);
    return this;
  }

  /** The body writer — write module code here. */
  get writer(): CodeWriter {
    return this.body;
  }

  /** Finalize into a GeneratedModule. */
  build(): GeneratedModule {
    const importBlock = this.imports.render();
    const sections: string[] = [];
    if (this.header.length > 0) sections.push(this.header.join('\n') + '\n');
    if (importBlock !== '') sections.push(importBlock);
    sections.push(this.body.toString());
    return {
      path: this.path,
      source: sections.join('\n'),
      imports: this.imports.specifiers(),
    };
  }
}

/**
 * Conservative whitespace minifier: strips line comments, leading indentation
 * and blank lines. Never touches string contents (operates line-wise and only
 * removes comments when `//` starts a line).
 */
export function minifySource(source: string): string {
  return source
    .split('\n')
    .map((l) => l.trimEnd())
    .map((l) => l.replace(/^\s+/, ''))
    .filter((l) => l !== '' && !l.startsWith('//'))
    .join('\n')
    .trim() + '\n';
}
