/**
 * @lumen/app-marketplace — paid template metadata (Phase 15).
 *
 * Additive layer over TemplateMeta: a template MAY carry a price. The base
 * TemplateMeta interface is untouched; priced entries are described by the
 * PaidTemplateMeta intersection plus a runtime guard/codec so untrusted
 * catalog data can be narrowed safely.
 */

import { makeThumbnail, type TemplateMeta } from './meta.js';

/** Price of a paid template. Amounts are integer cents. */
export interface TemplatePrice {
  /** Price in the smallest currency unit (e.g. USD cents). */
  amountCents: number;
  /** ISO 4217 currency code (e.g. 'USD'). */
  currency: string;
}

/** A TemplateMeta that carries a price. Purely additive over TemplateMeta. */
export type PaidTemplateMeta = TemplateMeta & { price: TemplatePrice };

/** Runtime guard: true when the meta carries a well-formed price. */
export function isPaidTemplateMeta(meta: TemplateMeta): meta is PaidTemplateMeta {
  const price = (meta as Partial<PaidTemplateMeta>).price;
  return (
    typeof price === 'object' &&
    price !== null &&
    Number.isInteger(price.amountCents) &&
    price.amountCents >= 0 &&
    typeof price.currency === 'string' &&
    /^[A-Z]{3}$/.test(price.currency)
  );
}

/** Codec: strip a paid meta down to its price. */
export function encodePrice(meta: PaidTemplateMeta): TemplatePrice {
  return { amountCents: meta.price.amountCents, currency: meta.price.currency };
}

/** Codec: attach a price to a base meta, producing a PaidTemplateMeta. */
export function withPrice(meta: TemplateMeta, price: TemplatePrice): PaidTemplateMeta {
  if (!Number.isInteger(price.amountCents) || price.amountCents < 0) {
    throw new Error(`withPrice: amountCents must be a non-negative integer, got ${price.amountCents}`);
  }
  if (!/^[A-Z]{3}$/.test(price.currency)) {
    throw new Error(`withPrice: currency must be a 3-letter ISO code, got '${price.currency}'`);
  }
  return { ...meta, price: { ...price } };
}

/**
 * Sample priced catalog entries. These reuse the builtin seed shape but are
 * standalone: they are NOT merged into BuiltinSource (which stays free/pro
 * tiered); they exist so purchase flows and tests have stable fixtures.
 */
export const PRICED_TEMPLATES: readonly PaidTemplateMeta[] = [
  {
    id: 'aurora-commerce-landing',
    name: 'Aurora Commerce — Landing',
    description: 'A paid scroll-cinema landing tuned for product launches.',
    templateKind: 'scroll-video',
    version: '1.0.0',
    categories: ['landing', 'product'],
    tags: ['paid', 'cinema', 'launch'],
    thumbnail: makeThumbnail('aurora-commerce-landing'),
    tier: 'pro',
    author: 'Lumen Studio',
    engineMinVersion: '0.1.0',
    price: { amountCents: 2900, currency: 'USD' },
    previewSceneCount: 3,
    entryConfig: {
      version: 3,
      id: 'aurora-commerce-landing',
      template: 'scroll-video',
      meta: {
        title: 'Aurora Commerce',
        description: 'A paid scroll-cinema landing tuned for product launches.',
        locale: 'en',
      },
      theme: { colors: { background: '#07070b', foreground: '#f5f3ee', accent: '#d0a95f' } },
      assets: [],
      scenes: [
        {
          id: 'stage',
          slot: 'stage',
          nodes: [{ id: 'stage-copy', kind: 'dom', html: '<h1>Launch day.</h1>' }],
          track: { driver: 'scroll', durationOrRange: 10 },
          a11y: { label: 'Stage' },
        },
        {
          id: 'pitch',
          slot: 'hero-caption',
          nodes: [{ id: 'pitch-copy', kind: 'dom', html: '<p>Built to convert.</p>' }],
          track: { driver: 'scroll', durationOrRange: 6 },
          a11y: { label: 'Pitch' },
        },
        {
          id: 'outro',
          slot: 'outro',
          nodes: [{ id: 'outro-copy', kind: 'dom', html: '<h2>Aurora Commerce</h2>' }],
          track: { driver: 'scroll', durationOrRange: 4 },
          a11y: { label: 'Outro' },
        },
      ],
      interactions: [],
      build: { target: 'static', ssr: true, minify: false },
    } as PaidTemplateMeta['entryConfig'],
  },
  {
    id: 'nocturne-folio',
    name: 'Nocturne — Folio',
    description: 'A paid cinematic portfolio with a two-act reveal.',
    templateKind: 'cinematic-spa',
    version: '1.0.0',
    categories: ['portfolio'],
    tags: ['paid', 'folio', 'cinematic'],
    thumbnail: makeThumbnail('nocturne-folio'),
    tier: 'pro',
    author: 'Lumen Studio',
    engineMinVersion: '0.1.0',
    price: { amountCents: 1900, currency: 'USD' },
    previewSceneCount: 3,
    entryConfig: {
      version: 3,
      id: 'nocturne-folio',
      template: 'cinematic-spa',
      meta: {
        title: 'Nocturne',
        description: 'A paid cinematic portfolio with a two-act reveal.',
        locale: 'en',
      },
      theme: { colors: { background: '#090910', foreground: '#efedf5', accent: '#8f7cf2' } },
      assets: [],
      scenes: [
        {
          id: 'title-card',
          slot: 'title-card',
          nodes: [{ id: 'title', kind: 'dom', html: '<h1>Nocturne</h1>' }],
          track: { driver: 'time', durationOrRange: 3 },
          a11y: { label: 'Title card' },
        },
        {
          id: 'act-1',
          slot: 'acts',
          nodes: [{ id: 'act-1-body', kind: 'dom', html: '<h2>Work</h2>' }],
          track: { driver: 'time', durationOrRange: 7 },
          a11y: { label: 'Act one' },
        },
        {
          id: 'act-2',
          slot: 'acts',
          nodes: [{ id: 'act-2-body', kind: 'dom', html: '<h2>Contact</h2>' }],
          track: { driver: 'time', durationOrRange: 5 },
          a11y: { label: 'Act two' },
        },
      ],
      interactions: [],
      build: { target: 'static', ssr: true, minify: false },
    } as PaidTemplateMeta['entryConfig'],
  },
];

/** Look up a priced sample entry by id. */
export function getPricedTemplate(templateId: string): PaidTemplateMeta | undefined {
  return PRICED_TEMPLATES.find((t) => t.id === templateId);
}
