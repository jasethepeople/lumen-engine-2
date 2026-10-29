export {
  ENTITLEMENT_KEYS,
  FREE_PLAN_ID,
  PRO_PLAN_ID,
  FREE_PROJECT_LIMIT,
  PRO_PROJECT_LIMIT,
  PLAN_ENTITLEMENTS,
  requiredPlanFor,
} from './entitlements.js';
export type { EntitlementKey } from './entitlements.js';
export { EntitlementDeniedError, isEntitlementDeniedError } from './errors.js';
export { EntitlementService } from './service.js';
export type {
  ExportKind,
  PlanResolver,
  TemplateMeta,
  TemplateTier,
} from './service.js';

// --- Phase 15: template access gating (additive) ---
export { canAccessTemplate } from './gating.js';
export type { OwnershipResolver, TemplateAccessMeta } from './gating.js';
