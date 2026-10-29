/**
 * @lumen/app-onboarding — persistence seams: createProjectFromWizard()
 * (real @lumen/app-projects integration) and saveDraft()/resumeDraft()
 * (serialize the wizard mid-flow so creators can leave and return).
 */

import type { Project, ProjectStore } from '@lumen/app-projects';
import { buildConfig, type BuildConfigOptions } from './build-config.js';
import { OnboardingWizard, type OnboardingWizardOptions } from './wizard.js';
import type { OnboardingDraft, WizardState } from './types.js';

/** Current draft envelope version. */
export const DRAFT_VERSION = 1 as const;

/**
 * Persist the wizard's answers as a Project via @lumen/app-projects.
 * Assembles the EngineConfig with buildConfig() (same options accepted),
 * creates the project, marks the wizard as saved (feeding the
 * first-publish checklist) and returns the created Project.
 */
export async function createProjectFromWizard(
  store: ProjectStore,
  wizardOrState: OnboardingWizard | WizardState,
  options: BuildConfigOptions & { name?: string } = {},
): Promise<Project> {
  const state = wizardOrState instanceof OnboardingWizard ? wizardOrState.state() : wizardOrState;
  const config = buildConfig(state, options);
  const project = await store.createProject({
    name: options.name ?? config.meta.title,
    templateKind: config.template,
    templateId: state.answers.templateId!,
    config,
  });
  if (wizardOrState instanceof OnboardingWizard) wizardOrState.markProjectSaved();
  return project;
}

/**
 * Serialize the wizard state to a JSON string (step position + answers).
 * Safe to persist anywhere (localStorage, file, backend).
 */
export function saveDraft(
  wizardOrState: OnboardingWizard | WizardState,
  now: () => number = () => Date.now(),
): string {
  const state = wizardOrState instanceof OnboardingWizard ? wizardOrState.state() : wizardOrState;
  const draft: OnboardingDraft = {
    draftVersion: DRAFT_VERSION,
    savedAt: new Date(now()).toISOString(),
    state,
  };
  return JSON.stringify(draft, null, 2);
}

/**
 * Rehydrate a wizard mid-flow from a saveDraft() payload. Restores step
 * position and all accumulated answers. Throws on malformed payloads or
 * unsupported draft versions.
 */
export function resumeDraft(
  json: string,
  options: OnboardingWizardOptions = {},
): OnboardingWizard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`resumeDraft: invalid JSON — ${(err as Error).message}`);
  }
  const draft = parsed as Partial<OnboardingDraft>;
  if (draft?.draftVersion !== DRAFT_VERSION) {
    throw new Error(
      `resumeDraft: unsupported draftVersion ${JSON.stringify(draft?.draftVersion)} (expected ${DRAFT_VERSION})`,
    );
  }
  const state = draft.state;
  if (!state || typeof state.stepId !== 'string' || typeof state.stepIndex !== 'number') {
    throw new Error('resumeDraft: payload is missing wizard state');
  }
  const answers = state.answers;
  if (!answers || !Array.isArray(answers.heroMedia) || !Array.isArray(answers.chapters)) {
    throw new Error('resumeDraft: wizard answers are missing or malformed');
  }
  return OnboardingWizard.fromState(state, options);
}
