/**
 * @lumen/templates — 'viewer-3d' descriptor.
 * Single 3D scene: model node from the manifest, pointer-orbit camera
 * bindings, camera defaults, and hotspot overlay slots.
 */

import type {
  ComposedScene,
  EngineConfig,
  AssetManifest,
  SceneNode,
  TemplateDescriptor,
  ThemeTokens,
} from '@lumen/contracts';
import {
  assembleScene,
  firstAssetOfKind,
  makeNode,
  makeTrack,
  manifestEntry,
  nodeFromConfig,
  resetIds,
  resolveBindings,
  type SceneRefEntry,
} from './internal.js';
import { defaultMotion, defaultSpacing, defaultTypeScale, resolveThemeTokens } from './theme.js';

export const VIEWER_3D_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'model', accepts: ['mesh'], min: 1, max: 1, region: 'spatial' },
  { id: 'hotspot', accepts: ['dom', 'sprite'], min: 0, max: 16, region: 'hybrid' },
];

export const VIEWER_3D_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#101014',
    foreground: '#ececf1',
    accent: '#6ee7b7',
    'hotspot-bg': 'rgba(16, 16, 20, 0.8)',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: defaultMotion(),
};

/** Default camera framing for a single-product 3D viewer. */
export const VIEWER_3D_CAMERA_DEFAULTS = {
  position: [0, 1.2, 3.2] as [number, number, number],
  fov: 45,
  near: 0.1,
  far: 100,
  target: [0, 0.5, 0] as [number, number, number],
};

function composeViewer3d(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(VIEWER_3D_THEME_DEFAULTS, cfg.theme);

  const modelScenes = cfg.scenes.filter((s) => s.slot === 'model');
  const hotspotScenes = cfg.scenes.filter((s) => s.slot === 'hotspot');

  const modelScene = modelScenes[0];
  const modelRef = modelScene?.nodes.find((n) => n.kind === 'mesh' && n.assetId);
  const modelAsset = manifestEntry(manifest, modelRef?.assetId) ?? firstAssetOfKind(manifest, 'model');
  const modelAssetId = modelRef?.assetId ?? modelAsset?.id ?? '';

  const orbitTrackId = `track-${modelScene?.id ?? 'model'}-orbit`;

  // Camera with template defaults.
  const camera = makeNode({
    id: 'node-viewer-camera',
    kind: 'camera',
    layer: 0,
    transform: { position: [...VIEWER_3D_CAMERA_DEFAULTS.position] },
    meta: {
      'viewer-3d': {
        fov: VIEWER_3D_CAMERA_DEFAULTS.fov,
        near: VIEWER_3D_CAMERA_DEFAULTS.near,
        far: VIEWER_3D_CAMERA_DEFAULTS.far,
        target: VIEWER_3D_CAMERA_DEFAULTS.target,
      },
    },
  });

  // Orbit track: pointer drag drives yaw 0..2π over the input range.
  const modelNodeId = `node-${modelScene?.id ?? 'model'}`;
  const orbitTrack = makeTrack(orbitTrackId, modelNodeId, 'pointer', [0, Math.PI * 2], [
    { t: 0, value: 0, easing: 'linear' },
    { t: Math.PI * 2, value: Math.PI * 2, easing: 'linear' },
  ]);

  const modelNode = makeNode({
    id: modelNodeId,
    kind: 'mesh',
    layer: 1,
    payload: { assetId: modelAssetId },
    bindings: [
      { trackId: orbitTrackId, property: 'transform.rotationQuat' },
      { trackId: orbitTrackId, property: 'transform.position' },
    ],
    meta: {
      'viewer-3d': {
        slot: 'model',
        a11y: modelScene?.a11y ?? { label: '3D model' },
        orbit: true,
        theme,
      },
    },
  });

  const tracks = [orbitTrack];
  const sceneRefs = new Map<string, SceneRefEntry>();
  if (modelScene)
    sceneRefs.set(modelScene.id, {
      nodeId: modelNodeId,
      trackId: orbitTrackId,
      range: [0, Math.PI * 2],
    });

  // Hotspot overlays anchored in 3D space.
  const hotspotNodes: SceneNode[] = [];
  for (const scene of hotspotScenes) {
    const dur =
      Number.isFinite(scene.track.durationOrRange) && scene.track.durationOrRange > 0
        ? scene.track.durationOrRange
        : 1;
    const trackId = `track-${scene.id}`;
    const group = makeNode({
      id: `node-${scene.id}`,
      kind: 'group',
      layer: 5,
      meta: { 'viewer-3d': { slot: 'hotspot', a11y: scene.a11y } },
    });
    const track = makeTrack(trackId, group.id, scene.track.driver, [0, dur], [
      { t: 0, value: 0, easing: 'ease-out' },
      { t: dur * 0.2, value: 1 },
      { t: dur, value: 1 },
    ]);
    group.bindings.push({ trackId, property: 'material.opacity' });
    for (const nc of scene.nodes) {
      group.children.push(nodeFromConfig(nc, scene, trackId, 6, 'viewer-3d'));
    }
    hotspotNodes.push(group);
    tracks.push(track);
    sceneRefs.set(scene.id, { nodeId: group.id, trackId, range: [0, dur] });
  }

  const bindings = resolveBindings(cfg, sceneRefs);
  const islands = hotspotNodes.map((n) => n.id);
  return assembleScene([camera, modelNode, ...hotspotNodes], tracks, bindings, islands, islands.length > 0);
}

export const viewer3dTemplate: TemplateDescriptor = {
  kind: 'viewer-3d',
  version: '0.1.0',
  slots: VIEWER_3D_SLOTS,
  themeTokens: VIEWER_3D_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2'],
    assetFeatures: ['draco', 'ktx2'],
    interactions: ['pointer', 'touch', 'deviceorientation'],
  },
  budgets: {
    jsGzBytes: 220_000,
    criticalAssetBytes: 3_000_000,
    firstFrameMs: 2_500,
  },
  compose: composeViewer3d,
};
