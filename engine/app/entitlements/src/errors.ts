/**
 * Error thrown when a plan lacks a required entitlement.
 */
import type { EntitlementKey } from './entitlements.js';

export class EntitlementDeniedError extends Error {
  readonly key: EntitlementKey;
  readonly requiredPlan: string;

  constructor(key: EntitlementKey, requiredPlan: string, message?: string) {
    super(
      message ??
        `Entitlement '${key}' requires the '${requiredPlan}' plan.`,
    );
    this.name = 'EntitlementDeniedError';
    this.key = key;
    this.requiredPlan = requiredPlan;
  }
}

export function isEntitlementDeniedError(
  err: unknown,
): err is EntitlementDeniedError {
  return err instanceof EntitlementDeniedError;
}
