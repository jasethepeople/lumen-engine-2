/**
 * @lumen/app-onboarding — OnboardingWizard: a finite step machine for the
 * creator onboarding flow.
 *
 *   welcome → choose-template → upload-hero-media → define-chapters
 *     → pick-theme → preview-motion → first-publish → done
 *
 * Headless and framework-free; a UI layer subscribes to snapshots and
 * forwards user input to next()/back()/goTo().
 */

import { getThemePreset } from '@lumen/app-settings';
import { ONBOARDING_STEPS, STEP_IDS, getStepContent, stepIndexOf } from './steps.js';
import type { TemplateInfo, TemplateProvider } from './template-provider.js';
import { RuntimeTemplateProvider } from './template-provider.js';
import {
  HERO_MEDIA_EXTENSIONS,
  MAX_CHAPTERS,
  MIN_CHAPTERS,
  PUBLISH_CHECKLIST,
  type ChapterInput,
  type HeroMediaRef,
  type MotionPref,
  type OnboardingStepId,
  type PublishChecklistItem,
  type StepContent,
  type StepResult,
  type WizardAnswers,
  type WizardListener,
  type WizardState,
} from './types.js';

/** Inputs accepted by next(), per step. */
export interface StepInput {
  /** choose-template: id from the TemplateProvider. */
  templateId?: string;
  /** upload-hero-media: one or more asset refs. */
  heroMedia?: HeroMediaRef[];
  /** define-chapters: 1–12 chapters. */
  chapters?: ChapterInput[];
  /** pick-theme: preset id from listThemePresets(). */
  themeId?: string;
  /** preview-motion: motion preference. */
  motionPref?: MotionPref;
  /** first-publish: chosen publish target label. */
  publishTarget?: string;
}

/** Options for constructing a wizard (and for resumeDraft()). */
export interface OnboardingWizardOptions {
  /** Template source; defaults to RuntimeTemplateProvider. */
  templateProvider?: TemplateProvider;
}

const MOTION_PREFS: readonly MotionPref[] = ['inherit', 'continuous', 'reveal', 'static'];

function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx < 0 ? '' : name.slice(idx + 1).toLowerCase();
}

function cloneAnswers(answers: WizardAnswers): WizardAnswers {
  return {
    ...(answers.templateId !== undefined ? { templateId: answers.templateId } : {}),
    heroMedia: answers.heroMedia.map((m) => ({ ...m })),
    chapters: answers.chapters.map((c) => ({ ...c })),
    ...(answers.themeId !== undefined ? { themeId: answers.themeId } : {}),
    ...(answers.motionPref !== undefined ? { motionPref: answers.motionPref } : {}),
    ...(answers.publishTarget !== undefined ? { publishTarget: answers.publishTarget } : {}),
  };
}

function emptyAnswers(): WizardAnswers {
  return { heroMedia: [], chapters: [] };
}

/**
 * OnboardingWizard — see module docstring for the step flow. All state
 * reads return deep-cloned snapshots; mutation happens only through the
 * navigation methods.
 */
export class OnboardingWizard {
  private readonly templateProvider: TemplateProvider;
  private templatesCache: TemplateInfo[] | undefined;
  private readonly listeners = new Set<WizardListener>();

  private stepIndex = 0;
  private answers: WizardAnswers = emptyAnswers();
  private projectSavedFlag = false;
  private doneFlag = false;

  constructor(options: OnboardingWizardOptions = {}) {
    this.templateProvider = options.templateProvider ?? new RuntimeTemplateProvider();
  }

  // ------------------------------------------------------------- content --

  /** Templates available at the choose-template step (cached). */
  listTemplates(): TemplateInfo[] {
    this.templatesCache ??= this.templateProvider.list();
    return [...this.templatesCache];
  }

  /** Static content (title/tooltip/checklist/optional) for a step. */
  stepContent(stepId?: OnboardingStepId): StepContent {
    return getStepContent(stepId ?? STEP_IDS[this.stepIndex]!);
  }

  /** All steps in order (for progress indicators). */
  steps(): readonly StepContent[] {
    return ONBOARDING_STEPS;
  }

  // --------------------------------------------------------------- state --

  /** Current step content. */
  current(): StepContent {
    return getStepContent(STEP_IDS[this.stepIndex]!);
  }

  /** Immutable snapshot of the full wizard state. */
  state(): WizardState {
    return {
      stepId: STEP_IDS[this.stepIndex]!,
      stepIndex: this.stepIndex,
      answers: cloneAnswers(this.answers),
      projectSaved: this.projectSavedFlag,
      done: this.doneFlag,
    };
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: WizardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.state();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** (Re)start the flow at the welcome step, preserving nothing. */
  start(): WizardState {
    this.stepIndex = 0;
    this.answers = emptyAnswers();
    this.projectSavedFlag = false;
    this.doneFlag = false;
    this.emit();
    return this.state();
  }

  /** Reset to the pristine pre-start state (alias of start()). */
  reset(): WizardState {
    return this.start();
  }

  // ---------------------------------------------------------- validation --

  private validateStep(stepId: OnboardingStepId, input: StepInput): string[] {
    switch (stepId) {
      case 'welcome':
      case 'done':
        return [];
      case 'choose-template': {
        const id = input.templateId;
        if (!id) return ['choose-template: templateId is required'];
        return this.listTemplates().some((t) => t.id === id)
          ? []
          : [`choose-template: unknown templateId '${id}'`];
      }
      case 'upload-hero-media': {
        const media = input.heroMedia;
        if (!media || media.length === 0) {
          return ['upload-hero-media: at least one asset is required'];
        }
        const errors: string[] = [];
        media.forEach((m, i) => {
          if (!m || typeof m.name !== 'string' || m.name.length === 0) {
            errors.push(`upload-hero-media: asset ${i} needs a file name`);
            return;
          }
          if (m.kind !== 'video' && m.kind !== 'image') {
            errors.push(
              `upload-hero-media: asset '${m.name}' kind must be 'video' or 'image'`,
            );
            return;
          }
          const ext = fileExtension(m.name);
          if (!HERO_MEDIA_EXTENSIONS[m.kind].includes(ext)) {
            errors.push(
              `upload-hero-media: '${m.name}' has unsupported extension '.${ext}' ` +
                `(allowed ${m.kind}: ${HERO_MEDIA_EXTENSIONS[m.kind].join(', ')})`,
            );
          }
        });
        return errors;
      }
      case 'define-chapters': {
        const chapters = input.chapters;
        if (!chapters || chapters.length < MIN_CHAPTERS) {
          return [`define-chapters: at least ${MIN_CHAPTERS} chapter is required`];
        }
        if (chapters.length > MAX_CHAPTERS) {
          return [
            `define-chapters: at most ${MAX_CHAPTERS} chapters allowed (got ${chapters.length})`,
          ];
        }
        const errors: string[] = [];
        const seen = new Set<string>();
        chapters.forEach((c, i) => {
          if (!c || typeof c.id !== 'string' || c.id.length === 0) {
            errors.push(`define-chapters: chapter ${i} needs an id`);
          } else if (seen.has(c.id)) {
            errors.push(`define-chapters: duplicate chapter id '${c.id}'`);
          } else {
            seen.add(c.id);
          }
          if (!c || typeof c.title !== 'string' || c.title.trim().length === 0) {
            errors.push(`define-chapters: chapter ${i} needs a title`);
          }
          if (c?.duration !== undefined && !(typeof c.duration === 'number' && c.duration >= 0)) {
            errors.push(`define-chapters: chapter '${c.id}' duration must be a number ≥ 0`);
          }
        });
        return errors;
      }
      case 'pick-theme': {
        const id = input.themeId;
        if (!id) return ['pick-theme: themeId is required'];
        return getThemePreset(id) ? [] : [`pick-theme: unknown theme preset '${id}'`];
      }
      case 'preview-motion': {
        const pref = input.motionPref;
        if (!pref) return ['preview-motion: motionPref is required'];
        return MOTION_PREFS.includes(pref)
          ? []
          : [`preview-motion: motionPref must be one of ${MOTION_PREFS.join(', ')}`];
      }
      case 'first-publish': {
        const errors: string[] = [];
        if (!input.publishTarget || input.publishTarget.trim().length === 0) {
          errors.push('first-publish: a publish target must be chosen');
        }
        const checklist = this.checklistStatus({
          publishTarget: input.publishTarget ?? this.answers.publishTarget,
        });
        for (const item of PUBLISH_CHECKLIST) {
          if (!checklist[item]) errors.push(`first-publish: checklist item '${item}' is not complete`);
        }
        return errors;
      }
    }
  }

  /** Record a validated answer into the accumulated answers. */
  private applyInput(stepId: OnboardingStepId, input: StepInput): void {
    switch (stepId) {
      case 'choose-template':
        this.answers.templateId = input.templateId!;
        break;
      case 'upload-hero-media':
        this.answers.heroMedia = input.heroMedia!.map((m) => ({ ...m }));
        break;
      case 'define-chapters':
        this.answers.chapters = input.chapters!.map((c) => ({ ...c }));
        break;
      case 'pick-theme':
        this.answers.themeId = input.themeId!;
        break;
      case 'preview-motion':
        this.answers.motionPref = input.motionPref!;
        break;
      case 'first-publish':
        this.answers.publishTarget = input.publishTarget!;
        break;
      default:
        break;
    }
  }

  /**
   * Has the given step been completed (valid answer recorded)? Optional
   * steps count as complete once visited.
   */
  private isStepComplete(stepId: OnboardingStepId, answers: WizardAnswers): boolean {
    switch (stepId) {
      case 'welcome':
      case 'done':
        return true;
      case 'choose-template':
        return (
          answers.templateId !== undefined &&
          this.listTemplates().some((t) => t.id === answers.templateId)
        );
      case 'upload-hero-media':
        return answers.heroMedia.length >= 1;
      case 'define-chapters':
        return (
          answers.chapters.length >= MIN_CHAPTERS && answers.chapters.length <= MAX_CHAPTERS
        );
      case 'pick-theme':
        return answers.themeId !== undefined && getThemePreset(answers.themeId) !== undefined;
      case 'preview-motion':
        return answers.motionPref !== undefined;
      case 'first-publish':
        return answers.publishTarget !== undefined;
    }
  }

  // ----------------------------------------------------------- navigation --

  /**
   * Validate the input for the current step, record it, and advance.
   * Optional steps (welcome) may advance with no input.
   */
  next(input: StepInput = {}): StepResult {
    const stepId = STEP_IDS[this.stepIndex]!;
    const errors = this.validateStep(stepId, input);
    if (errors.length > 0) return { ok: false, errors, state: this.state() };
    this.applyInput(stepId, input);
    if (this.stepIndex < STEP_IDS.length - 1) this.stepIndex++;
    if (STEP_IDS[this.stepIndex] === 'done') this.doneFlag = true;
    this.emit();
    return { ok: true, state: this.state() };
  }

  /** Go back one step, preserving all recorded answers. */
  back(): StepResult {
    if (this.stepIndex === 0) {
      return { ok: false, errors: ['already at the first step'], state: this.state() };
    }
    this.stepIndex--;
    this.doneFlag = false;
    this.emit();
    return { ok: true, state: this.state() };
  }

  /**
   * Jump to a step. Going backwards always works; going forwards requires
   * every required step before the target to be complete (no skipping
   * ahead past incomplete steps).
   */
  goTo(stepId: OnboardingStepId): StepResult {
    const target = stepIndexOf(stepId);
    if (target < 0) {
      return { ok: false, errors: [`unknown step '${stepId}'`], state: this.state() };
    }
    if (target > this.stepIndex) {
      const blockers: string[] = [];
      for (let i = this.stepIndex; i < target; i++) {
        const id = STEP_IDS[i]!;
        if (!this.isStepComplete(id, this.answers)) {
          blockers.push(`step '${id}' is not complete`);
        }
      }
      if (blockers.length > 0) return { ok: false, errors: blockers, state: this.state() };
    }
    this.stepIndex = target;
    this.doneFlag = stepId === 'done' ? this.doneFlag : false;
    this.emit();
    return { ok: true, state: this.state() };
  }

  // ------------------------------------------------------------ checklist --

  /**
   * Mark the project as saved (called by createProjectFromWizard()).
   * Feeds the 'project saved' first-publish checklist item.
   */
  markProjectSaved(): void {
    this.projectSavedFlag = true;
    this.emit();
  }

  /**
   * Derived status of the first-publish walkthrough checklist, computed
   * from accumulated wizard state. An optional override publishTarget lets
   * validation preview a not-yet-recorded answer.
   */
  checklistStatus(
    override: { publishTarget?: string } = {},
  ): Record<PublishChecklistItem, boolean> {
    const publishTarget = override.publishTarget ?? this.answers.publishTarget;
    return {
      'project saved': this.projectSavedFlag,
      'assets processed': this.answers.heroMedia.length >= 1,
      'motion previewed': this.answers.motionPref !== undefined,
      'publish target chosen': publishTarget !== undefined && publishTarget.trim().length > 0,
    };
  }

  // ------------------------------------------------------- draft support --

  /**
   * Restore a wizard from a previously saved draft state (used by
   * resumeDraft()). Internal invariants are re-validated defensively.
   */
  static fromState(state: WizardState, options: OnboardingWizardOptions = {}): OnboardingWizard {
    const wizard = new OnboardingWizard(options);
    const idx = stepIndexOf(state.stepId);
    wizard.stepIndex = idx >= 0 ? idx : 0;
    wizard.answers = cloneAnswers(state.answers);
    wizard.projectSavedFlag = state.projectSaved === true;
    wizard.doneFlag = state.done === true && STEP_IDS[wizard.stepIndex] === 'done';
    return wizard;
  }
}
