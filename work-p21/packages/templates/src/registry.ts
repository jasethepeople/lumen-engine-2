/**
 * @lumen/templates — template registry.
 * Register/lookup descriptors by TemplateKind, validate configs against
 * slot definitions (warnings, not fatal), and expose module requirements.
 */

import type {
  EngineConfig,
  ModuleRequirement,
  TemplateDescriptor,
  TemplateKind,
} from '@lumen/contracts';
import { scrollVideoTemplate } from './scroll-video.js';
import { cinematicSpaTemplate } from './cinematic-spa.js';
import { viewer3dTemplate } from './viewer-3d.js';
import { storytellingTemplate } from './storytelling.js';
import { scrollCinemaLandingTemplate } from './scroll-cinema-landing.js';
import { cinematicStoryTemplate } from './cinematic-story.js';
import { productShowcaseTemplate } from './product-showcase.js';

/** A non-fatal validation finding. */
export interface TemplateValidationWarning {
  /** Dot-path or slot id the warning concerns. */
  path: string;
  /** Human-readable message. */
  message: string;
  /** Severity: 'warning' findings never block composition. */
  severity: 'warning';
}

/** Result of validating an EngineConfig against a descriptor. */
export interface TemplateValidationResult {
  valid: boolean;
  warnings: TemplateValidationWarning[];
}

export class TemplateRegistry {
  private readonly descriptors = new Map<TemplateKind, TemplateDescriptor>();

  /** Register (or replace) a descriptor. Returns this for chaining. */
  register(descriptor: TemplateDescriptor): this {
    this.descriptors.set(descriptor.kind, descriptor);
    return this;
  }

  /** Look up a descriptor by kind; undefined when not registered. */
  get(kind: TemplateKind): TemplateDescriptor | undefined {
    return this.descriptors.get(kind);
  }

  /** Look up a descriptor, throwing when not registered. */
  require(kind: TemplateKind): TemplateDescriptor {
    const d = this.descriptors.get(kind);
    if (!d) throw new Error(`No template registered for kind '${kind}'`);
    return d;
  }

  /** All registered kinds, in registration order. */
  kinds(): TemplateKind[] {
    return [...this.descriptors.keys()];
  }

  /** All registered descriptors. */
  list(): TemplateDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** Module requirements (tree-shaking contract) per registered kind. */
  capabilities(): Record<string, ModuleRequirement> {
    const out: Record<string, ModuleRequirement> = {};
    for (const [kind, d] of this.descriptors) out[kind] = d.requiredCapabilities;
    return out;
  }

  /**
   * Validate an EngineConfig against the descriptor for cfg.template.
   * Missing or excess slot content, kind mismatches, and unknown slots are
   * reported as warnings — validation never blocks composition.
   */
  validate(cfg: EngineConfig): TemplateValidationResult {
    const warnings: TemplateValidationWarning[] = [];
    const descriptor = this.descriptors.get(cfg.template);
    if (!descriptor) {
      warnings.push({
        path: 'template',
        message: `No template registered for kind '${cfg.template}'.`,
        severity: 'warning',
      });
      return { valid: warnings.length === 0, warnings };
    }

    const slotById = new Map(descriptor.slots.map((s) => [s.id, s]));
    const countBySlot = new Map<string, number>();

    for (const scene of cfg.scenes) {
      const slot = slotById.get(scene.slot);
      if (!slot) {
        warnings.push({
          path: `scenes.${scene.id}.slot`,
          message: `Scene '${scene.id}' targets unknown slot '${scene.slot}' for template '${cfg.template}'.`,
          severity: 'warning',
        });
        continue;
      }
      countBySlot.set(scene.slot, (countBySlot.get(scene.slot) ?? 0) + 1);
      for (const node of scene.nodes) {
        if (!slot.accepts.includes(node.kind)) {
          warnings.push({
            path: `scenes.${scene.id}.nodes.${node.id}`,
            message: `Node kind '${node.kind}' is not accepted by slot '${scene.slot}' (accepts: ${slot.accepts.join(', ')}).`,
            severity: 'warning',
          });
        }
      }
    }

    for (const slot of descriptor.slots) {
      const count = countBySlot.get(slot.id) ?? 0;
      if (count < slot.min) {
        warnings.push({
          path: `slots.${slot.id}`,
          message: `Slot '${slot.id}' requires at least ${slot.min} scene(s); config provides ${count}.`,
          severity: 'warning',
        });
      } else if (count > slot.max) {
        warnings.push({
          path: `slots.${slot.id}`,
          message: `Slot '${slot.id}' allows at most ${slot.max} scene(s); config provides ${count}.`,
          severity: 'warning',
        });
      }
    }

    for (const ic of cfg.interactions) {
      if (!cfg.scenes.some((s) => s.id === ic.scene)) {
        warnings.push({
          path: `interactions.${ic.id}`,
          message: `Interaction '${ic.id}' targets unknown scene '${ic.scene}'.`,
          severity: 'warning',
        });
      }
    }

    return { valid: warnings.length === 0, warnings };
  }
}

/** A registry pre-populated with the four built-in template descriptors. */
export function createDefaultRegistry(): TemplateRegistry {
  return new TemplateRegistry()
    .register(scrollVideoTemplate)
    .register(cinematicSpaTemplate)
    .register(viewer3dTemplate)
    .register(storytellingTemplate);
}

/**
 * An extended registry: the four built-ins plus the three specialization
 * descriptors — `scroll-cinema-landing`, `cinematic-story`, and
 * `product-showcase`. Because
 * TemplateKind is frozen and the registry keys descriptors by kind, the
 * specializations replace the stock descriptors for 'scroll-video' and
 * 'cinematic-spa' in this registry; they are distinguished by descriptor
 * version, exported descriptor ids, and node meta namespacing.
 * `createDefaultRegistry()` is unchanged for compatibility.
 */
export function createExtendedRegistry(): TemplateRegistry {
  return createDefaultRegistry()
    .register(scrollCinemaLandingTemplate)
    .register(cinematicStoryTemplate)
    .register(productShowcaseTemplate);
}
