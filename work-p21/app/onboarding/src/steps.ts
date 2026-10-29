/**
 * @lumen/app-onboarding — static step definitions (tooltips + checklists).
 */

import type { OnboardingStepId, StepContent } from './types.js';

/** Ordered step content; index in this array is the wizard position. */
export const ONBOARDING_STEPS: readonly StepContent[] = Object.freeze([
  {
    id: 'welcome',
    title: 'Welcome to Lumen',
    tooltip:
      'Lumen turns your videos and images into a cinematic web page — no coding needed. This short setup walks you through it, one small decision at a time.',
    checklist: ['meet the builder', 'see what you will create'],
    optional: true,
  },
  {
    id: 'choose-template',
    title: 'Choose a starting template',
    tooltip:
      'A template is a ready-made page layout that decides how your story scrolls and moves. Pick the one closest to what you imagine — you can change everything else later.',
    checklist: ['browse templates', 'pick one that fits your story'],
    optional: false,
  },
  {
    id: 'upload-hero-media',
    title: 'Add your hero media',
    tooltip:
      'Your hero media is the first video or image visitors see. Add at least one file — MP4/WebM videos or WebP, AVIF, JPG and PNG images all work.',
    checklist: ['add at least one video or image', 'check file format is supported'],
    optional: false,
  },
  {
    id: 'define-chapters',
    title: 'Define your chapters',
    tooltip:
      'Chapters are the sections of your page, like scenes in a film. Give each one a short title; you can have anywhere from 1 to 12.',
    checklist: ['name between 1 and 12 chapters', 'order them the way your story flows'],
    optional: false,
  },
  {
    id: 'pick-theme',
    title: 'Pick a theme',
    tooltip:
      'A theme sets the colors and feel of your page in one click. Choose a preset you like — every color can still be fine-tuned afterwards.',
    checklist: ['preview the presets', 'choose one theme'],
    optional: false,
  },
  {
    id: 'preview-motion',
    title: 'Preview the motion',
    tooltip:
      'Motion is how your page animates as people scroll. Try each style and pick the one that feels right — or keep the template default.',
    checklist: ['preview each motion style', 'choose a motion preference'],
    optional: false,
  },
  {
    id: 'first-publish',
    title: 'Publish your first page',
    tooltip:
      'You are one click away. We will check that everything is ready, then you choose where your page goes live.',
    checklist: [
      'project saved',
      'assets processed',
      'motion previewed',
      'publish target chosen',
    ],
    optional: false,
  },
  {
    id: 'done',
    title: 'All done',
    tooltip:
      'Your page is live and your project is saved. You can come back any time to keep editing.',
    checklist: ['celebrate', 'keep editing when you are ready'],
    optional: true,
  },
]);

/** Step ids in order. */
export const STEP_IDS: readonly OnboardingStepId[] = Object.freeze(
  ONBOARDING_STEPS.map((s) => s.id),
);

/** Look up step content by id (throws on unknown id — ids are a closed set). */
export function getStepContent(id: OnboardingStepId): StepContent {
  const step = ONBOARDING_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`@lumen/app-onboarding: unknown step id '${id}'`);
  return step;
}

/** Index of a step id in the fixed order (-1 when unknown). */
export function stepIndexOf(id: OnboardingStepId): number {
  return STEP_IDS.indexOf(id);
}
