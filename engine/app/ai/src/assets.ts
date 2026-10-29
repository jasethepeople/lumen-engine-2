/**
 * @lumen/app-ai — asset tagging and colorway detection.
 *
 * Local heuristics over asset filenames, extensions, and (optionally) the
 * first bytes of the file for magic-number sniffing (mp4/webp/avif).
 * No I/O is performed: callers pass bytes explicitly.
 */

/** Media classification used by the AI author. */
export type MediaKind = 'video' | 'image';

/** Colorway label inferred from filename suffixes. */
export type Colorway = 'light' | 'dark' | 'vibrant' | 'muted';

/** Input to {@link tagAsset}. */
export interface TagAssetInput {
  /** File name or path (extension drives classification). */
  name: string;
  /** Optional leading bytes of the file for magic-number sniffing. */
  bytes?: Uint8Array;
  /** Optional caller-provided metadata hints. */
  meta?: Record<string, unknown>;
}

/** Result of {@link tagAsset}. */
export interface AssetTags {
  mediaKind: MediaKind;
  /** True when the asset looks like a hero/background candidate. */
  isHeroCandidate: boolean;
  /** Colorway variant when the name carries one. */
  colorway?: Colorway;
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'] as const;
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg', 'bmp', 'tiff'] as const;

const HERO_WORDS = ['hero', 'background', 'backdrop', 'cover', 'banner', 'loop', 'intro', 'splash'] as const;

const COLORWAY_SUFFIXES: ReadonlyArray<[Colorway, RegExp]> = [
  ['light', /(?:^|[-_.\s])light(?:[-_.\s]|$)/i],
  ['dark', /(?:^|[-_.\s])dark(?:[-_.\s]|$)/i],
  ['vibrant', /(?:^|[-_.\s])(?:vibrant|bright|color|colour)(?:[-_.\s]|$)/i],
  ['muted', /(?:^|[-_.\s])(?:muted|mono|grayscale|greyscale|desat)(?:[-_.\s]|$)/i],
];

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Sniff leading bytes for known container magic numbers. */
function sniffMagic(bytes: Uint8Array): MediaKind | undefined {
  // ISO BMFF (mp4/mov): bytes 4..8 == 'ftyp'; AVIF is also BMFF but the
  // brand at bytes 8..12 is 'avif'/'avis'.
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image';
    return 'video';
  }
  // WebP: 'RIFF' .... 'WEBP'.
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image';
  }
  // WebM/MKV: EBML header 0x1A45DFA3.
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video';
  }
  // PNG / JPEG / GIF magics.
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if (bytes.length >= 6 && (ascii(bytes, 0, 3) === 'GIF')) return 'image';
  return undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Tag an asset from its name plus optional magic bytes. Byte sniffing wins
 * over extension when both are present and disagree on video-vs-image.
 */
export function tagAsset(input: TagAssetInput): AssetTags {
  const name = input.name;
  const stem = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '');
  const ext = extensionOf(name);

  let mediaKind: MediaKind | undefined;
  if (input.bytes && input.bytes.length > 0) {
    mediaKind = sniffMagic(input.bytes);
  }
  if (!mediaKind) {
    if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) mediaKind = 'video';
    else if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) mediaKind = 'image';
    else if (input.meta?.['mediaKind'] === 'video' || input.meta?.['mediaKind'] === 'image') {
      mediaKind = input.meta['mediaKind'] as MediaKind;
    } else {
      mediaKind = 'image'; // safe default: images cannot crash a video pipeline
    }
  }

  const lowerStem = stem.toLowerCase();
  const isHeroCandidate =
    HERO_WORDS.some((w) => lowerStem.includes(w)) ||
    input.meta?.['role'] === 'hero' ||
    (mediaKind === 'video' && lowerStem.includes('bg'));

  let colorway: Colorway | undefined;
  for (const [label, re] of COLORWAY_SUFFIXES) {
    if (re.test(stem)) {
      colorway = label;
      break;
    }
  }

  return { mediaKind, isHeroCandidate, ...(colorway ? { colorway } : {}) };
}

/** A group of assets believed to be colorway variants of one base asset. */
export interface ColorwayGroup {
  /** Shared name stem (colorway suffix stripped). */
  stem: string;
  /** Asset names in the group, in input order. */
  variants: string[];
}

/** Strip a recognized colorway suffix from a file stem. */
function stemWithoutColorway(name: string): string {
  const stem = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '');
  return stem
    .replace(/[-_.\s](?:light|dark|vibrant|bright|color|colour|muted|mono|grayscale|greyscale|desat)$/i, '')
    .toLowerCase();
}

/**
 * Group assets whose names differ only by a colorway suffix
 * (e.g. 'hero-dark.mp4' / 'hero-light.mp4'). Only stems with two or more
 * variants are returned.
 */
export function detectColorwayVariants(assets: ReadonlyArray<TagAssetInput | string>): ColorwayGroup[] {
  const groups = new Map<string, string[]>();
  for (const asset of assets) {
    const name = typeof asset === 'string' ? asset : asset.name;
    const stem = stemWithoutColorway(name);
    const list = groups.get(stem) ?? [];
    list.push(name);
    groups.set(stem, list);
  }
  const out: ColorwayGroup[] = [];
  for (const [stem, variants] of groups) {
    if (variants.length >= 2 && stem) out.push({ stem, variants });
  }
  return out;
}
