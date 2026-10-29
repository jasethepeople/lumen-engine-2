/**
 * Minimal Buffer global for the in-browser publish pipeline.
 *
 * @lumen/build's contentHash()/gzipSize() call Buffer.from(string, 'utf8')
 * and Buffer.from(Uint8Array). The Builder only ever routes UTF-8 text and
 * byte arrays through these, so a TextEncoder-backed implementation is
 * faithful (no base64/hex encodings are used on this path).
 */

const BufferShim = {
  from(input: string | Uint8Array | ArrayLike<number>, encoding?: string): Uint8Array {
    if (typeof input === 'string') {
      if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
        throw new Error(`Buffer shim: unsupported encoding "${encoding}"`);
      }
      return new TextEncoder().encode(input);
    }
    return input instanceof Uint8Array ? input : new Uint8Array(Array.from(input));
  },
  isBuffer(value: unknown): boolean {
    return value instanceof Uint8Array;
  },
};

export function installBufferGlobal(): void {
  const g = globalThis as { Buffer?: unknown };
  if (typeof g.Buffer === 'undefined') {
    g.Buffer = BufferShim;
  }
}
