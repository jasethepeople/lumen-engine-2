/**
 * @lumen/app-onboarding — creator onboarding flow engine for the Lumen
 * Builder (framework-free; a React UI consumes it).
 *
 *   const wizard = new OnboardingWizard();
 *   wizard.subscribe(render);
 *   wizard.start();
 *   wizard.next();                                  // welcome → choose-template
 *   wizard.next({ templateId: 'scroll-cinema-landing' });
 *   ...
 *   const project = await createProjectFromWizard(store, wizard);
 *   wizard.next({ publishTarget: 'lumen.hosting' }); // first-publish → done
 */

export {
  HERO_MEDIA_EXTENSIONS,
  MAX_CHAPTERS,
  MIN_CHAPTERS,
  PUBLISH_CHECKLIST,
} from './types.js';
export type {
  ChapterInput,
  HeroMediaRef,
  MotionPref,
  OnboardingDraft,
  OnboardingStepId,
  PublishChecklistItem,
  StepContent,
  StepResult,
  WizardAnswers,
  WizardListener,
  WizardState,
} from './types.js';
export { ONBOARDING_STEPS, STEP_IDS, getStepContent, stepIndexOf } from './steps.js';
export type { TemplateInfo, TemplateProvider } from './template-provider.js';
export { RuntimeTemplateProvider } from './template-provider.js';
export { OnboardingWizard } from './wizard.js';
export type { OnboardingWizardOptions, StepInput } from './wizard.js';
export { buildConfig } from './build-config.js';
export type { BuildConfigOptions } from './build-config.js';
export { DRAFT_VERSION, createProjectFromWizard, resumeDraft, saveDraft } from './project.js';
