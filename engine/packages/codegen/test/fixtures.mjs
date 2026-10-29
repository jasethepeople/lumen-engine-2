/**
 * Shared fixtures: a minimal valid EngineConfig, TemplateDescriptor-ish
 * defaults, and a hand-composed ComposedScene exercising dom + video nodes.
 */

export function makeConfig() {
  return {
    version: 3,
    id: 'demo-site',
    template: 'scroll-video',
    meta: {
      title: 'Demo "Site" <tag>',
      description: 'A demo site & more',
      locale: 'en-US',
      ogImage: 'https://example.com/og.png',
    },
    theme: { colors: { 'color-accent': '#ff0055' } },
    assets: [
      { id: 'hero-video', src: '/media/hero.mp4', kind: 'video', preload: 'critical' },
      { id: 'unused-img', src: '/media/x.png', kind: 'image', preload: 'critical' },
    ],
    scenes: [
      {
        id: 'hero',
        slot: 'main',
        nodes: [
          { id: 'n-copy', kind: 'dom', html: '<h1>Hello</h1>' },
          { id: 'n-vid', kind: 'video-plane', assetId: 'hero-video' },
          { id: 'n-ghost', kind: 'video-plane', assetId: 'ghost-asset' },
        ],
        track: { driver: 'scroll', durationOrRange: 2000 },
        a11y: { label: 'Hero scene' },
      },
    ],
    interactions: [
      { id: 'ix-scroll', source: 'scroll', scene: 'hero', inputRange: [0, 2000] },
    ],
    build: { target: 'static' },
  };
}

export function makeThemeTokens() {
  return {
    colors: { 'color-bg': '#000000', 'color-fg': '#ffffff' },
    typeScale: { body: { size: '1rem', lineHeight: 1.5, weight: 400 } },
    spacing: { md: '1rem' },
    motion: {
      standard: [0.4, 0, 0.2, 1],
      emphasized: [0.2, 0, 0, 1],
      duration: { fast: 150, slow: 600 },
    },
  };
}

export function makeDescriptor() {
  return {
    kind: 'scroll-video',
    version: '0.1.0',
    slots: [{ id: 'main', accepts: ['dom', 'video-plane'], min: 1, max: 8, region: 'hybrid' }],
    themeTokens: makeThemeTokens(),
    requiredCapabilities: { renderers: ['dom', 'canvas2d'], assetFeatures: ['hls'], interactions: ['scroll'] },
    budgets: { jsGzBytes: 150_000, criticalAssetBytes: 2_000_000, firstFrameMs: 800 },
    compose: () => makeScene(),
  };
}

export function makeScene() {
  return {
    sceneGraph: [
      {
        id: 'root',
        kind: 'group',
        transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
        layer: 0,
        visible: true,
        bindings: [],
        meta: { note: 'root <unsafe> &' },
        children: [
          {
            id: 'n-copy',
            kind: 'dom',
            transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
            layer: 1,
            visible: true,
            bindings: [{ trackId: 't-scroll', property: 'transform.position.y' }],
            children: [],
            payload: { html: '<h1>Hello</h1>' },
          },
          {
            id: 'n-vid',
            kind: 'video-plane',
            transform: { position: [0, 0, -1], rotationQuat: [0, 0, 0, 1], scale: [16, 9, 1] },
            layer: 0,
            visible: true,
            bindings: [],
            children: [],
            payload: { assetId: 'hero-video', scrubbed: true },
          },
          {
            id: 'n-ghost',
            kind: 'video-plane',
            transform: { position: [0, 0, -1], rotationQuat: [0, 0, 0, 1], scale: [16, 9, 1] },
            layer: 0,
            visible: true,
            bindings: [],
            children: [],
            payload: { assetId: 'ghost-asset', scrubbed: false },
          },
        ],
      },
    ],
    tracks: [
      {
        id: 't-scroll',
        target: 'n-copy',
        keyframes: [
          { t: 0, value: 0 },
          { t: 1, value: 200, easing: 'ease-out' },
        ],
        driver: 'scroll',
        range: [0, 2000],
      },
    ],
    bindings: [
      {
        id: 'ix-scroll',
        source: 'scroll',
        targetNodeId: 'n-copy',
        targetTrackId: 't-scroll',
        mapping: { inputRange: [0, 2000], outputRange: [0, 1] },
        a11yFallback: 'static',
      },
    ],
    hydration: { ssr: true, islands: ['hero'] },
  };
}

export function makeOptions(target, overrides = {}) {
  return { target: { target, ...overrides } };
}
