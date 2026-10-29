/**
 * @lumen/app-marketplace — BuiltinSource seed data.
 *
 * Entries for the three real specialization templates in @lumen/templates
 * (scroll-cinema-landing, cinematic-story, product-showcase) are authored
 * faithfully from examples/*\/engine.config.json and the engine's own
 * showcase test config; their `templateKind` is the frozen TemplateKind
 * actually declared in each specialization source file. Three additional
 * 'pro' templates round out the catalog with minimal, valid entryConfigs.
 *
 * Every entryConfig here is asserted to pass parseConfig() in the tests.
 */

import type { EngineConfig } from '@lumen/contracts';
import { makeThumbnail, type TemplateMeta } from './meta.js';

/** Current engine line the marketplace ships against. */
const ENGINE_MIN = '0.1.0';

const scrollCinemaLandingConfig = {
  version: 3,
  id: 'scroll-cinema-landing',
  template: 'scroll-video',
  meta: {
    title: 'Aurora — Scroll Cinema',
    description: 'A premium scroll-scrubbed cinematic landing page built with Lumen.',
    locale: 'en',
  },
  theme: {
    colors: { background: '#050507', foreground: '#f4f2ec', accent: '#c9a86a' },
  },
  assets: [
    {
      id: 'cinema-video',
      src: 'https://media.example.com/lumen/aurora.mp4',
      kind: 'video',
      duration: 12,
      preload: 'critical',
    },
    {
      id: 'cinema-poster',
      src: 'https://media.example.com/lumen/aurora-poster.jpg',
      kind: 'image',
      preload: 'eager',
    },
  ],
  scenes: [
    {
      id: 'stage',
      slot: 'stage',
      nodes: [{ id: 'stage-video', kind: 'video-plane', assetId: 'cinema-video' }],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: {
        label: 'Aurora background film',
        summary: 'An aurora borealis timelapse scrubbed by page scroll.',
      },
    },
    {
      id: 'brand',
      slot: 'logo',
      nodes: [{ id: 'brand-mark', kind: 'dom', html: '<span class="logo">AURORA</span>' }],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Brand logo' },
    },
    {
      id: 'hero-caption',
      slot: 'hero-caption',
      nodes: [
        { id: 'hero-title', kind: 'dom', html: '<h1>Light, in motion.</h1><p>Scroll to begin.</p>' },
      ],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Hero caption' },
    },
    {
      id: 'chapter-1',
      slot: 'chapters',
      nodes: [
        { id: 'chapter-1-text', kind: 'dom', html: '<h2>Chapter I</h2><p>The sky ignites.</p>' },
      ],
      track: { driver: 'scroll', durationOrRange: 2 },
      a11y: { label: 'Chapter one' },
    },
    {
      id: 'chapter-2',
      slot: 'chapters',
      nodes: [
        {
          id: 'chapter-2-text',
          kind: 'dom',
          html: '<h2>Chapter II</h2><p>Colour becomes weather.</p>',
        },
      ],
      track: { driver: 'scroll', durationOrRange: 2 },
      a11y: { label: 'Chapter two' },
    },
    {
      id: 'chapter-3',
      slot: 'chapters',
      nodes: [
        {
          id: 'chapter-3-text',
          kind: 'dom',
          html: '<h2>Chapter III</h2><p>Silence, then dawn.</p>',
          meta: { scrollRange: [6.2, 8.2] },
        },
      ],
      track: { driver: 'scroll', durationOrRange: 2 },
      a11y: { label: 'Chapter three' },
    },
    {
      id: 'outro',
      slot: 'outro',
      nodes: [
        { id: 'outro-cta', kind: 'dom', html: '<h2>Aurora</h2><p>Available worldwide.</p>' },
      ],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Outro call to action' },
    },
  ],
  interactions: [
    {
      id: 'scroll-scrub',
      source: 'scroll',
      scene: 'stage',
      inputRange: [0, 1],
      a11yFallback: 'native-video',
    },
  ],
  build: { target: 'static', ssr: true, minify: false },
} as unknown as EngineConfig;

const cinematicStoryConfig = {
  version: 3,
  id: 'cinematic-story',
  template: 'cinematic-spa',
  meta: {
    title: 'The Long Way North',
    description: 'A single-page cinematic story told in three acts, built with Lumen.',
    locale: 'en',
  },
  theme: {
    colors: { background: '#08080c', foreground: '#efece4', accent: '#b0874f' },
  },
  assets: [
    {
      id: 'act-one-film',
      src: 'https://media.example.com/lumen/north-act1.mp4',
      kind: 'video',
      duration: 6,
      preload: 'critical',
    },
    {
      id: 'story-score',
      src: 'https://media.example.com/lumen/north-score.mp3',
      kind: 'audio',
      preload: 'eager',
    },
    {
      id: 'act-three-still',
      src: 'https://media.example.com/lumen/north-act3.jpg',
      kind: 'image',
      preload: 'lazy',
    },
  ],
  scenes: [
    {
      id: 'title-card',
      slot: 'title-card',
      nodes: [
        {
          id: 'title-text',
          kind: 'dom',
          html: '<h1>The Long Way North</h1><p>A story in three acts</p>',
        },
      ],
      track: { driver: 'time', durationOrRange: 3 },
      a11y: { label: 'Title card' },
    },
    {
      id: 'act-1',
      slot: 'acts',
      nodes: [
        { id: 'act-1-video', kind: 'video-plane', assetId: 'act-one-film' },
        { id: 'act-1-caption', kind: 'dom', html: '<h2>I. Departure</h2><p>The road unspools behind.</p>' },
      ],
      track: { driver: 'time', durationOrRange: 6 },
      a11y: { label: 'Act one: departure' },
    },
    {
      id: 'act-2',
      slot: 'acts',
      nodes: [
        {
          id: 'act-2-caption',
          kind: 'dom',
          html: '<h2>II. Weather</h2><p>The storm decides the pace.</p>',
          meta: { durationHint: 8 },
        },
      ],
      track: { driver: 'time', durationOrRange: 5 },
      a11y: { label: 'Act two: weather' },
    },
    {
      id: 'act-3',
      slot: 'acts',
      nodes: [
        { id: 'act-3-still', kind: 'sprite', assetId: 'act-three-still' },
        { id: 'act-3-caption', kind: 'dom', html: '<h2>III. Arrival</h2><p>North is a feeling, not a place.</p>' },
      ],
      track: { driver: 'time', durationOrRange: 6 },
      a11y: { label: 'Act three: arrival' },
    },
    {
      id: 'score',
      slot: 'score',
      nodes: [{ id: 'score-carrier', kind: 'dom', html: '', meta: { assetId: 'story-score' } }],
      track: { driver: 'time', durationOrRange: 0 },
      a11y: { label: 'Musical score' },
    },
    {
      id: 'credits',
      slot: 'credits',
      nodes: [
        { id: 'credits-roll', kind: 'dom', html: '<p>Directed by Lumen · Shot on location</p>' },
      ],
      track: { driver: 'time', durationOrRange: 4 },
      a11y: { label: 'Credits' },
    },
  ],
  interactions: [
    {
      id: 'kbd-next',
      source: 'keyboard',
      scene: 'act-1',
      inputRange: [0, 1],
      a11yFallback: 'static',
    },
  ],
  build: { target: 'static', ssr: true, minify: false },
} as unknown as EngineConfig;

const productShowcaseConfig = {
  version: 3,
  id: 'product-showcase',
  template: 'viewer-3d',
  meta: {
    title: 'Monolith — Product Showcase',
    description: 'An orbitable 3D product stage with scroll-revealed hotspots.',
    locale: 'en',
  },
  theme: {
    colors: { background: '#0d0d11', foreground: '#f2f2ef', accent: '#e0b45c' },
  },
  assets: [
    {
      id: 'product-model',
      src: 'https://media.example.com/lumen/product.glb',
      kind: 'model',
      preload: 'critical',
    },
  ],
  scenes: [
    {
      id: 'stage',
      slot: 'stage',
      nodes: [{ id: 'model', kind: 'mesh', assetId: 'product-model' }],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Product model' },
    },
    {
      id: 'hs-1',
      slot: 'hotspots',
      nodes: [
        { id: 'h1', kind: 'dom', html: '<p>Detail</p>', meta: { anchor: [0, 0.5, 0.3] } },
      ],
      track: { driver: 'scroll', durationOrRange: 5 },
      a11y: { label: 'Hotspot' },
    },
    {
      id: 'spec-sheet',
      slot: 'spec-sheet',
      nodes: [
        {
          id: 'spec-body',
          kind: 'dom',
          html: '<h2>Specifications</h2><ul><li>Machined aluminum</li><li>320 g</li></ul>',
        },
      ],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Specification sheet' },
    },
  ],
  interactions: [
    {
      id: 'drag',
      source: 'pointer',
      gesture: 'pan',
      scene: 'stage',
      inputRange: [0, 1],
      a11yFallback: 'static',
    },
  ],
  build: { target: 'static', ssr: true, minify: false },
} as unknown as EngineConfig;

/* --- 'pro' examples: minimal but valid configs over existing kinds. ------- */

const auroraSummitConfig = {
  version: 3,
  id: 'aurora-summit',
  template: 'cinematic-spa',
  meta: {
    title: 'Aurora Summit — Event Microsite',
    description: 'A keynote event microsite in two acts with a countdown title card.',
    locale: 'en',
  },
  theme: {
    colors: { background: '#0a0a12', foreground: '#f0eef8', accent: '#7c6cf0' },
  },
  assets: [],
  scenes: [
    {
      id: 'title-card',
      slot: 'title-card',
      nodes: [
        { id: 'title', kind: 'dom', html: '<h1>Aurora Summit</h1><p>October 12 · Oslo</p>' },
      ],
      track: { driver: 'time', durationOrRange: 3 },
      a11y: { label: 'Title card' },
    },
    {
      id: 'act-1',
      slot: 'acts',
      nodes: [
        { id: 'act-1-body', kind: 'dom', html: '<h2>Speakers</h2><p>Twelve voices, one stage.</p>' },
      ],
      track: { driver: 'time', durationOrRange: 6 },
      a11y: { label: 'Act one: speakers' },
    },
    {
      id: 'act-2',
      slot: 'acts',
      nodes: [
        { id: 'act-2-body', kind: 'dom', html: '<h2>Tickets</h2><p>Early bird ends soon.</p>' },
      ],
      track: { driver: 'time', durationOrRange: 6 },
      a11y: { label: 'Act two: tickets' },
    },
  ],
  interactions: [],
  build: { target: 'static', ssr: true, minify: false },
} as unknown as EngineConfig;

const folioMonoConfig = {
  version: 3,
  id: 'folio-mono',
  template: 'storytelling',
  meta: {
    title: 'Folio Mono — Portfolio',
    description: 'A typographic long-form portfolio built on the storytelling blocks.',
    locale: 'en',
  },
  theme: {
    colors: { background: '#fafaf7', foreground: '#1a1a1a', accent: '#b3532f' },
  },
  assets: [],
  scenes: [
    {
      id: 'intro',
      slot: 'block',
      nodes: [
        { id: 'intro-text', kind: 'dom', html: '<h1>Studio Mono</h1><p>Selected work 2019–2025.</p>' },
      ],
      track: { driver: 'scroll', durationOrRange: 4 },
      a11y: { label: 'Introduction' },
    },
    {
      id: 'project-1',
      slot: 'block',
      nodes: [
        { id: 'project-1-text', kind: 'dom', html: '<h2>Meridian</h2><p>Identity &amp; web.</p>' },
      ],
      track: { driver: 'scroll', durationOrRange: 4 },
      a11y: { label: 'Project: Meridian' },
    },
  ],
  interactions: [],
  build: { target: 'static', ssr: true, minify: false },
} as unknown as EngineConfig;

const prismLabConfig = {
  version: 3,
  id: 'prism-lab',
  template: 'viewer-3d',
  meta: {
    title: 'Prism Lab — Experimental Object Viewer',
    description: 'An experimental WebGL object viewer with a single orbiting artifact.',
    locale: 'en',
  },
  theme: {
    colors: { background: '#05060a', foreground: '#e8f0ff', accent: '#4cc9f0' },
  },
  assets: [
    {
      id: 'artifact',
      src: 'https://media.example.com/lumen/artifact.glb',
      kind: 'model',
      preload: 'critical',
    },
  ],
  scenes: [
    {
      id: 'stage',
      slot: 'stage',
      nodes: [{ id: 'artifact-mesh', kind: 'mesh', assetId: 'artifact' }],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Artifact model' },
    },
  ],
  interactions: [
    {
      id: 'orbit',
      source: 'pointer',
      gesture: 'pan',
      scene: 'stage',
      inputRange: [0, 1],
      a11yFallback: 'static',
    },
  ],
  build: { target: 'static', ssr: true, minify: false },
} as unknown as EngineConfig;

function meta(entry: Omit<TemplateMeta, 'thumbnail'>): TemplateMeta {
  return { ...entry, thumbnail: makeThumbnail(entry.id) };
}

/** Seed metadata for {@link BuiltinSource}. */
export const BUILTIN_TEMPLATES: readonly TemplateMeta[] = [
  meta({
    id: 'scroll-cinema-landing',
    name: 'Scroll Cinema Landing',
    description:
      'Premium scroll-scrubbed cinematic landing page: parallax video stage, hero caption, chapter overlays and an outro.',
    templateKind: 'scroll-video',
    version: '1.0.0',
    categories: ['landing'],
    tags: ['video', 'scroll', 'cinematic', 'landing', 'parallax'],
    tier: 'free',
    author: 'Lumen Core Team',
    engineMinVersion: ENGINE_MIN,
    entryConfig: scrollCinemaLandingConfig,
    previewSceneCount: 7,
  }),
  meta({
    id: 'cinematic-story',
    name: 'Cinematic Story',
    description:
      'Single-page cinematic storytelling on a time clock: title card, crossfading acts, score and credits.',
    templateKind: 'cinematic-spa',
    version: '1.0.0',
    categories: ['storytelling'],
    tags: ['story', 'cinematic', 'time', 'crossfade', 'narrative'],
    tier: 'free',
    author: 'Lumen Core Team',
    engineMinVersion: ENGINE_MIN,
    entryConfig: cinematicStoryConfig,
    previewSceneCount: 6,
  }),
  meta({
    id: 'product-showcase',
    name: 'Product Showcase',
    description:
      'Orbitable 3D product stage with scroll-revealed DOM hotspots, spec sheet and colorway variants.',
    templateKind: 'viewer-3d',
    version: '1.0.0',
    categories: ['product'],
    tags: ['3d', 'product', 'ecommerce', 'hotspots', 'webgl'],
    tier: 'free',
    author: 'Lumen Core Team',
    engineMinVersion: ENGINE_MIN,
    entryConfig: productShowcaseConfig,
    previewSceneCount: 3,
  }),
  meta({
    id: 'aurora-summit',
    name: 'Aurora Summit',
    description:
      'Keynote event microsite in two crossfading acts with a countdown title card and tickets call-to-action.',
    templateKind: 'cinematic-spa',
    version: '0.2.0',
    categories: ['event'],
    tags: ['event', 'conference', 'microsite', 'cinematic'],
    tier: 'pro',
    author: 'Lumen Studio',
    engineMinVersion: ENGINE_MIN,
    entryConfig: auroraSummitConfig,
    previewSceneCount: 3,
  }),
  meta({
    id: 'folio-mono',
    name: 'Folio Mono',
    description:
      'Typographic long-form portfolio built on storytelling blocks; editorial rhythm, zero assets required.',
    templateKind: 'storytelling',
    version: '0.3.1',
    categories: ['portfolio'],
    tags: ['portfolio', 'editorial', 'typography', 'story'],
    tier: 'pro',
    author: 'Lumen Studio',
    engineMinVersion: ENGINE_MIN,
    entryConfig: folioMonoConfig,
    previewSceneCount: 2,
  }),
  meta({
    id: 'prism-lab',
    name: 'Prism Lab',
    description:
      'Experimental WebGL object viewer: a single orbiting artifact with pointer orbit and scroll range.',
    templateKind: 'viewer-3d',
    version: '0.1.0',
    categories: ['experimental', 'product'],
    tags: ['experimental', 'webgl', '3d', 'viewer'],
    tier: 'pro',
    author: 'Lumen Studio',
    engineMinVersion: ENGINE_MIN,
    entryConfig: prismLabConfig,
    previewSceneCount: 1,
  }),
];
