/** Shared minimal fixtures for template compose() tests. */
export function makeManifest() {
  return {
    version: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    assets: {
      'hero-video': {
        id: 'hero-video',
        kind: 'video',
        preload: 'critical',
        bytes: 1_000_000,
        duration: 12,
        width: 1920,
        height: 1080,
        poster: '/assets/hero.jpg',
        variants: { mp4: { url: '/assets/hero.mp4', bytes: 1_000_000, codec: 'h264' } },
        scrubOptimized: true,
      },
      'product-model': {
        id: 'product-model',
        kind: 'model',
        preload: 'critical',
        bytes: 800_000,
        url: '/assets/product.glb',
        textures: 'ktx2',
        draco: true,
        bounds: { min: [-1, 0, -1], max: [1, 1, 1] },
      },
    },
  };
}

export function makeConfig(template, scenes = [], interactions = []) {
  return {
    version: 3,
    id: 'fixture',
    template,
    meta: { title: 'Fixture', description: 'test', locale: 'en' },
    theme: {},
    assets: [],
    scenes,
    interactions,
    build: { target: 'static', ssr: true, minify: true, moduleFormat: 'esm' },
  };
}

export function scene(id, slot, nodes, driver = 'scroll', duration = 4) {
  return {
    id,
    slot,
    nodes,
    track: { driver, durationOrRange: duration },
    a11y: { label: `Scene ${id}` },
  };
}

/** Structural validation of a ComposedScene. Throws on violation. */
export function assertComposedSceneValid(composed) {
  if (!Array.isArray(composed.sceneGraph)) throw new Error('sceneGraph not array');
  if (!Array.isArray(composed.tracks)) throw new Error('tracks not array');
  if (!Array.isArray(composed.bindings)) throw new Error('bindings not array');
  if (typeof composed.hydration !== 'object') throw new Error('hydration missing');
  const ids = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (ids.has(n.id)) throw new Error(`duplicate node id ${n.id}`);
      ids.add(n.id);
      if (!Array.isArray(n.transform.position) || n.transform.position.length !== 3)
        throw new Error(`bad transform on ${n.id}`);
      walk(n.children);
    }
  };
  walk(composed.sceneGraph);
  const trackIds = new Set(composed.tracks.map((t) => t.id));
  for (const t of composed.tracks) {
    if (!ids.has(t.target)) throw new Error(`track ${t.id} targets missing node`);
    for (let i = 1; i < t.keyframes.length; i++) {
      if (t.keyframes[i].t < t.keyframes[i - 1].t) throw new Error(`unsorted keyframes on ${t.id}`);
    }
  }
  for (const b of composed.bindings) {
    if (!trackIds.has(b.targetTrackId)) throw new Error(`binding ${b.id} targets missing track`);
  }
}
