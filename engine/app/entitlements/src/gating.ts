/**
 * @lumen/app-entitlements — template access gating (Phase 15).
 *
 * canAccessTemplate() is the boolean (non-throwing) complement to
 * EntitlementService.gateTemplate(): free plan → free templates only; pro
 * plan → everything; an individual template purchase overrides the plan on
 * the free tier via a caller-supplied ownership resolver (e.g. backed by
 * @lumen/app-marketplace's PurchaseStore). Pure function — no I/O, no
 * imports from billing or marketplace.
 */

import type { EntitlementService } from './service.js';

/** Minimal template shape needed for access gating. */
export interface TemplateAccessMeta {
  id: string;
  tier?: 'free' | 'pro';
}

/**
 * Ownership resolver: true when the user individually purchased the
 * template. Optional — without it, purchases cannot grant access.
 */
export type OwnershipResolver = (userId: string, templateId: string) => boolean;

/**
 * Pure access check:
 * - pro plan holds 'templates.pro' → every template is accessible;
 * - free plan → free (or untiered) templates only;
 * - on the free plan, an individual purchase of the template grants access.
 */
export function canAccessTemplate(
  service: EntitlementService,
  userId: string,
  meta: TemplateAccessMeta,
  ownsTemplate?: OwnershipResolver,
): boolean {
  if (service.can('templates.pro')) return true;
  const tier = meta.tier ?? 'free';
  if (tier === 'free') return true;
  return ownsTemplate?.(userId, meta.id) ?? false;
}
