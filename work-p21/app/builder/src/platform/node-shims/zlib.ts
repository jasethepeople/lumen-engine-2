/**
 * Browser shim for the slice of node:zlib used by @lumen/build: gzipSync().
 *
 * Browsers have no synchronous DEFLATE, so this emits a VALID gzip member
 * using stored (uncompressed) DEFLATE blocks — the same encoding
 * `gzipSync(data, { level: 0 })` produces. Only `.length` is consumed by the
 * budget pipeline, and a stored member's size is a deterministic,
 * conservative UPPER BOUND on the level-9 size the Node pipeline reports
 * (input + 18 bytes of gzip framing + 5 bytes per 64 KiB block), so budgets
 * enforced here are never looser than the CLI's.
 *
 * The bytes are a real, gunzippable gzip stream (correct header, stored
 * blocks, CRC-32 + ISIZE trailer).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  throw new Error('zlib shim: unsupported payload');
}

/** gzip member with stored DEFLATE blocks (valid; size ≥ level-9 size). */
export function gzipSync(data: unknown): Uint8Array {
  const input = toBytes(data);
  const blocks = Math.max(1, Math.ceil(input.length / 0xffff));
  const out = new Uint8Array(10 + input.length + blocks * 5 + 8);
  const view = new DataView(out.buffer);
  let o = 0;
  // Header: magic, CM=deflate, FLG=0, MTIME=0, XFL=0, OS=unknown.
  out.set([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff], 0);
  o = 10;
  for (let b = 0; b < blocks; b++) {
    const start = b * 0xffff;
    const len = Math.min(0xffff, input.length - start);
    const last = b === blocks - 1;
    out[o++] = last ? 0x01 : 0x00; // BFINAL + BTYPE=stored
    view.setUint16(o, len, true);
    view.setUint16(o + 2, ~len & 0xffff, true);
    o += 4;
    out.set(input.subarray(start, start + len), o);
    o += len;
  }
  view.setUint32(o, crc32(input), true);
  view.setUint32(o + 4, input.length >>> 0, true);
  return out;
}

export default { gzipSync };
