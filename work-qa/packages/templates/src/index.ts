/**
 * @lumen/templates — public API.
 * TemplateDescriptors for the four frontend types, the template registry,
 * and theme token resolution / CSS variable emission.
 */

export {
  scrollVideoTemplate,
  SCROLL_VIDEO_SLOTS,
  SCROLL_VIDEO_THEME_DEFAULTS,
} from './scroll-video.js';
export {
  cinematicSpaTemplate,
  CINEMATIC_SPA_SLOTS,
  CINEMATIC_SPA_THEME_DEFAULTS,
} from './cinematic-spa.js';
export {
  viewer3dTemplate,
  VIEWER_3D_SLOTS,
  VIEWER_3D_THEME_DEFAULTS,
  VIEWER_3D_CAMERA_DEFAULTS,
} from './viewer-3d.js';
export {
  storytellingTemplate,
  STORYTELLING_SLOTS,
  STORYTELLING_THEME_DEFAULTS,
} from './storytelling.js';
export {
  scrollCinemaLandingTemplate,
  SCROLL_CINEMA_LANDING_ID,
  SCROLL_CINEMA_LANDING_SLOTS,
  SCROLL_CINEMA_LANDING_THEME_DEFAULTS,
  HERO_CAPTION_FADE_FRACTION,
  OUTRO_FADE_FRACTION,
  PARALLAX_SCALE,
} from './scroll-cinema-landing.js';
export {
  cinematicStoryTemplate,
  CINEMATIC_STORY_ID,
  CINEMATIC_STORY_SLOTS,
  CINEMATIC_STORY_THEME_DEFAULTS,
  TITLE_CARD_DURATION_S,
  CROSSFADE_S,
} from './cinematic-story.js';
export {
  TemplateRegistry,
  createDefaultRegistry,
  createExtendedRegistry,
  type TemplateValidationResult,
  type TemplateValidationWarning,
} from './registry.js';
export {
  resolveThemeTokens,
  toCssVariables,
  toCssVariablesString,
  defaultTypeScale,
  defaultSpacing,
  defaultMotion,
} from './theme.js';
