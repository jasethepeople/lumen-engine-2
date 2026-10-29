/**
 * Entitlement keys and the plan -> entitlements matrix.
 *
 * This package is framework-free and zero-dependency; it deliberately does
 * not import @lumen/app-billing so the gating layer can be consumed by
 * builder/marketplace/publish without pulling in billing internals.
 */

export type EntitlementKey =
  | 'export.static'
  | 'export.custom-domain'
  | 'templates.pro'
  | 'assets.hybrid-pipeline'
  | 'projects.unlimited'
  | 'publish.vercel';

export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = Object.freeze([
  'export.static',
  'export.custom-domain',
  'templates.pro',
  'assets.hybrid-pipeline',
  'projects.unlimited',
  'publish.vercel',
] as EntitlementKey[]);

export const FREE_PLAN_ID = 'free';
export const PRO_PLAN_ID = 'pro';

/**
 * The entitlement matrix. Free covers the basics (static export, core
 * templates via the absence of 'templates.pro', up to 3 projects via the
 * absence of 'projects.unlimited'); pro unlocks everything.
 */
export const PLAN_ENTITLEMENTS: Readonly<Record<string, ReadonlySet<EntitlementKey>>> =
  Object.freeze({
    free: new Set<EntitlementKey>(['export.static']),
    pro: new Set<EntitlementKey>(ENTITLEMENT_KEYS),
  });

/** Maximum projects per plan. */
export const FREE_PROJECT_LIMIT = 3;
export const PRO_PROJECT_LIMIT = Number.POSITIVE_INFINITY;

/** The minimum plan that grants a key (free beats pro when both grant it). */
export function requiredPlanFor(key: EntitlementKey): string {
  if (PLAN_ENTITLEMENTS[FREE_PLAN_ID]?.has(key)) return FREE_PLAN_ID;
  return PRO_PLAN_ID;
}
