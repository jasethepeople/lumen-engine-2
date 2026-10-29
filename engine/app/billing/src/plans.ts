/**
 * Plan catalog for Lumen billing.
 *
 * The catalog is intentionally tiny (free + pro) and fully static — the mock
 * provider never talks to a network, so these descriptors are the single
 * source of truth for pricing/features surfaced to the app layer.
 */

export interface PlanDescriptor {
  id: string;
  name: string;
  /** Monthly price in USD cents. 0 for the free plan. */
  priceMonthly: number;
  features: string[];
}

export const FREE_PLAN_ID = 'free';
export const PRO_PLAN_ID = 'pro';

export const PLANS: Readonly<Record<string, PlanDescriptor>> = Object.freeze({
  free: Object.freeze({
    id: FREE_PLAN_ID,
    name: 'Free',
    priceMonthly: 0,
    features: [
      'export.static',
      'templates.core',
      'projects.up-to-3',
    ],
  }),
  pro: Object.freeze({
    id: PRO_PLAN_ID,
    name: 'Pro',
    priceMonthly: 1900,
    features: [
      'export.static',
      'export.custom-domain',
      'templates.core',
      'templates.pro',
      'assets.hybrid-pipeline',
      'projects.unlimited',
      'publish.vercel',
    ],
  }),
});

export function isPlanId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLANS, id);
}

export function getPlan(id: string): PlanDescriptor | undefined {
  return PLANS[id];
}
