/**
 * EntitlementService — gating API consumed by builder / marketplace / publish.
 */
import {
  ENTITLEMENT_KEYS,
  FREE_PLAN_ID,
  FREE_PROJECT_LIMIT,
  PLAN_ENTITLEMENTS,
  PRO_PROJECT_LIMIT,
  requiredPlanFor,
} from './entitlements.js';
import type { EntitlementKey } from './entitlements.js';
import { EntitlementDeniedError } from './errors.js';

/** Resolves the current plan id (e.g. from a BillingProvider). */
export type PlanResolver = () => string;

export type TemplateTier = 'free' | 'pro';

/** Minimal template metadata needed for gating (marketplace supplies more). */
export interface TemplateMeta {
  id?: string;
  tier?: TemplateTier;
}

export type ExportKind = 'static' | 'custom-domain';

const EXPORT_ENTITLEMENT: Readonly<Record<ExportKind, EntitlementKey>> = Object.freeze({
  static: 'export.static',
  'custom-domain': 'export.custom-domain',
});

export class EntitlementService {
  private readonly resolvePlan: PlanResolver;

  constructor(planResolver: PlanResolver) {
    this.resolvePlan = planResolver;
  }

  /** The plan id currently in effect (defaults to free if unknown). */
  planId(): string {
    const id = this.resolvePlan();
    return Object.prototype.hasOwnProperty.call(PLAN_ENTITLEMENTS, id)
      ? id
      : FREE_PLAN_ID;
  }

  can(key: EntitlementKey): boolean {
    return PLAN_ENTITLEMENTS[this.planId()]?.has(key) ?? false;
  }

  /** Throws EntitlementDeniedError carrying { key, requiredPlan }. */
  assertCan(key: EntitlementKey): void {
    if (!this.can(key)) {
      throw new EntitlementDeniedError(key, requiredPlanFor(key));
    }
  }

  /** 3 for free, Infinity for pro. */
  projectLimit(): number {
    return this.can('projects.unlimited') ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
  }

  /**
   * Gates a marketplace template by its tier field. Untiered templates are
   * treated as 'free'. Returns true when usable, throws otherwise.
   */
  gateTemplate(templateMeta: TemplateMeta): boolean {
    const tier: TemplateTier = templateMeta.tier ?? 'free';
    if (tier === 'pro') {
      this.assertCan('templates.pro');
    }
    return true;
  }

  /** Gates an export kind ('static' | 'custom-domain'). */
  gateExport(kind: ExportKind): boolean {
    this.assertCan(EXPORT_ENTITLEMENT[kind]);
    return true;
  }

  /** All keys the current plan holds (useful for UI feature lists). */
  grantedKeys(): EntitlementKey[] {
    return ENTITLEMENT_KEYS.filter((key) => this.can(key));
  }
}
