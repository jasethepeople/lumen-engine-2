/**
 * @lumen/app-onboarding — shared types for the creator onboarding wizard.
 *
 * Framework-free TypeScript so builder UI, CLI and tests can all consume it.
 */

/** A hero-media asset reference provided by the creator at upload time. */
export interface HeroMediaRef {
  /** Original file name (extension is validated against an allowlist). */
  name: string;
  /** Media kind. */
  kind: 'video' | 'image';
}

/** A chapter (becomes one scene in the generated EngineConfig). */
export interface ChapterInput {
  id: string;
  title: string;
  /** Optional scroll duration/range for the chapter track (ms or px). */
  duration?: number;
}

/** Motion preference picked at the preview-motion step. */
export type MotionPref = 'inherit' | 'continuous' | 'reveal' | 'static';

/** Accumulated answers, keyed conceptually by step. */
export interface WizardAnswers {
  /** Chosen template id (choose-template). */
  templateId?: string;
  /** Hero media asset refs (upload-hero-media). */
  heroMedia: HeroMediaRef[];
  /** Chapters, 1–12 (define-chapters). */
  chapters: ChapterInput[];
  /** Theme preset id from @lumen/app-settings (pick-theme). */
  themeId?: string;
  /** Motion preference (preview-motion). */
  motionPref?: MotionPref;
  /** Chosen publish target label (first-publish). */
  publishTarget?: string;
}

/** Immutable snapshot of the wizard state (draft-serializable). */
export interface WizardState {
  /** Id of the current step. */
  stepId: OnboardingStepId;
  /** Zero-based index of the current step. */
  stepIndex: number;
  /** Accumulated answers so far. */
  answers: WizardAnswers;
  /** True once createProjectFromWizard() has persisted the project. */
  projectSaved: boolean;
  /** True once the final 'done' step has been reached. */
  done: boolean;
}

/** Step ids in fixed order. */
export type OnboardingStepId =
  | 'welcome'
  | 'choose-template'
  | 'upload-hero-media'
  | 'define-chapters'
  | 'pick-theme'
  | 'preview-motion'
  | 'first-publish'
  | 'done';

/** Static per-step content shown to the creator. */
export interface StepContent {
  id: OnboardingStepId;
  title: string;
  /** 1–2 sentence plain-language hint for non-technical creators. */
  tooltip: string;
  /** Short checklist of what this step covers. */
  checklist: string[];
  /** Optional steps can be skipped via next() without input. */
  optional: boolean;
}

/** Result of a validation / navigation attempt. */
export type StepResult =
  | { ok: true; state: WizardState }
  | { ok: false; errors: string[]; state: WizardState };

/** Change listener; receives a fresh immutable snapshot. */
export type WizardListener = (state: WizardState) => void;

/** Checklist item ids for the first-publish walkthrough. */
export const PUBLISH_CHECKLIST = [
  'project saved',
  'assets processed',
  'motion previewed',
  'publish target chosen',
] as const;

export type PublishChecklistItem = (typeof PUBLISH_CHECKLIST)[number];

/** Draft envelope used by saveDraft()/resumeDraft(). */
export interface OnboardingDraft {
  draftVersion: 1;
  savedAt: string;
  state: WizardState;
}

/** Extension allowlist per hero-media kind. */
export const HERO_MEDIA_EXTENSIONS: Readonly<Record<'video' | 'image', readonly string[]>> =
  Object.freeze({
    video: ['mp4', 'webm'],
    image: ['webp', 'avif', 'jpg', 'png'],
  });

/** Minimum/maximum chapter counts (define-chapters). */
export const MIN_CHAPTERS = 1;
export const MAX_CHAPTERS = 12;
