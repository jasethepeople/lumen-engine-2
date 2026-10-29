/**
 * DeviceClassDetector — conservative client capability heuristics mapping
 * coarse navigator signals to a device class, plus per-class pipeline
 * profiles that decide which optimization ops a hosted build should run.
 *
 * Heuristics (conservative — when signals conflict we classify downward,
 * i.e. toward the less capable class):
 *   low-power:
 *     - deviceMemory <= 2 GB, or
 *     - hardwareConcurrency <= 2, or
 *     - mobile user agent AND deviceMemory <= 4 GB
 *   mobile:
 *     - mobile/tablet user agent, or
 *     - screenWidth < 768 CSS px, or
 *     - deviceMemory <= 4 GB (memory-constrained even on desktop UA)
 *   desktop: everything else.
 *
 * Unknown signals never upgrade a classification: missing fields are simply
 * not evidence. The userAgent match covers the common mobile tokens
 * (Android, iPhone/iPad/iPod, Mobile, Windows Phone, BlackBerry, webOS).
 */
import type { AssetOp } from './executor.js';

export type DeviceClass = 'desktop' | 'mobile' | 'low-power';

export interface DeviceClassInput {
  hardwareConcurrency?: number;
  /** navigator.deviceMemory (GB). */
  deviceMemory?: number;
  userAgent?: string;
  /** Viewport/screen width in CSS px. */
  screenWidth?: number;
}

const MOBILE_UA_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i;

export function detectDeviceClass(input: DeviceClassInput): DeviceClass {
  const cores = input.hardwareConcurrency;
  const memory = input.deviceMemory;
  const mobileUA = input.userAgent !== undefined && MOBILE_UA_RE.test(input.userAgent);
  const narrowScreen = input.screenWidth !== undefined && input.screenWidth < 768;

  if (
    (memory !== undefined && memory <= 2) ||
    (cores !== undefined && cores <= 2) ||
    (mobileUA && memory !== undefined && memory <= 4)
  ) {
    return 'low-power';
  }
  if (mobileUA || narrowScreen || (memory !== undefined && memory <= 4)) {
    return 'mobile';
  }
  return 'desktop';
}

export interface PipelineProfile {
  deviceClass: DeviceClass;
  /** Ops to run, in order. */
  ops: readonly AssetOp[];
  /** Frame-stack fps tiers (empty for low-power — no frame stack). */
  frameStackFps: readonly number[];
  /** Whether a poster image should be produced. */
  poster: boolean;
  /** Human-readable rationale (surfaced in builder UI). */
  rationale: string;
}

/**
 * Recommended pipeline per device class:
 *   desktop   — full hybrid set (scrub + frame stack at 15/30 fps + poster).
 *   mobile    — hybrid set biased to frame stacks (12/24 fps tiers).
 *   low-power — scrub-mp4 only; no frame stack (decode cost dominates),
 *               no poster extraction pass.
 */
export function pickPipelineProfile(deviceClass: DeviceClass): PipelineProfile {
  switch (deviceClass) {
    case 'desktop':
      return {
        deviceClass,
        ops: ['probe', 'scrub-mp4', 'frame-stack', 'manifest'],
        frameStackFps: [15, 30],
        poster: true,
        rationale: 'Full hybrid variant set: GOP-1 scrub MP4 plus webp frame stacks at 15/30 fps.',
      };
    case 'mobile':
      return {
        deviceClass,
        ops: ['probe', 'scrub-mp4', 'frame-stack', 'manifest'],
        frameStackFps: [12, 24],
        poster: true,
        rationale: 'Frame-stack-biased hybrid set with lower fps tiers for cellular bandwidth.',
      };
    case 'low-power':
      return {
        deviceClass,
        ops: ['probe', 'scrub-mp4', 'manifest'],
        frameStackFps: [],
        poster: false,
        rationale: 'Scrub MP4 only — frame stacks are skipped to bound decode and memory cost.',
      };
  }
}
