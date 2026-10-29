/** Shared fixtures for @lumen/assets tests. */
export const FIXTURE_MANIFEST = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  assets: {
    hero: {
      kind: 'image',
      preload: 'critical',
      bytes: 12000,
      width: 1920,
      height: 1080,
      variants: {
        avif: { srcset: { 640: '/assets/aaaa1111/hero-640.avif', 1920: '/assets/aaaa1111/hero-1920.avif' } },
        fallback: { url: '/assets/bbbb2222/hero.jpg', mime: 'image/jpeg' },
      },
      dominantColor: '#101418',
    },
    intro: {
      kind: 'video',
      preload: 'eager',
      bytes: 900000,
      duration: 12,
      width: 1920,
      height: 1080,
      poster: '/assets/cccc3333/intro-poster.jpg',
      variants: {
        hls: { playlist: '/assets/cccc3333/intro.m3u8', bandwidths: [800000, 2400000] },
        mp4: { url: '/assets/cccc3333/intro.mp4', bytes: 900000, codec: 'h264' },
      },
      scrubOptimized: true,
    },
    logo: {
      kind: 'lottie',
      preload: 'lazy',
      bytes: 50000,
      url: '/assets/dddd4444/logo.json',
      duration: 3,
      frameRate: 60,
    },
    bodyFont: {
      kind: 'font',
      preload: 'critical',
      bytes: 40000,
      family: 'Inter',
      url: '/assets/eeee5555/inter-400.woff2',
      weight: 400,
      style: 'normal',
    },
    theme: {
      kind: 'audio',
      preload: 'lazy',
      bytes: 200000,
      duration: 30,
      variants: {
        opus: { url: '/assets/ffff6666/theme.opus', bytes: 200000 },
      },
    },
    chair: {
      kind: 'model',
      preload: 'eager',
      bytes: 700000,
      url: '/assets/0000aaaa/chair.glb',
      textures: 'ktx2',
      draco: true,
      bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    },
  },
};
