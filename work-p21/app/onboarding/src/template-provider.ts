/**
 * @lumen/app-onboarding — template provider seam.
 *
 * The wizard needs a list of available templates but must not depend on
 * @lumen/app-marketplace (owned by another workstream). This interface is
 * the plug point: the default implementation wraps listTemplates() from
 * @lumen/app-runtime; the marketplace can later supply its own.
 */

import type { TemplateKind } from '@lumen/contracts';
import { listTemplates } from '@lumen/app-runtime';

/** Minimal template descriptor the wizard reasons about. */
export interface TemplateInfo {
  id: string;
  name: string;
  kind: TemplateKind;
}

/** Injectable source of templates for the choose-template step. */
export interface TemplateProvider {
  list(): TemplateInfo[];
}

/** Human-friendly display name from a template id. */
function displayName(id: string): string {
  return id
    .split('-')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * Default provider: wraps listTemplates() from @lumen/app-runtime
 * (extended registry — built-ins plus specialization descriptors).
 */
export class RuntimeTemplateProvider implements TemplateProvider {
  list(): TemplateInfo[] {
    return listTemplates().map((t) => ({
      id: t.id,
      name: displayName(t.id),
      kind: t.kind,
    }));
  }
}
