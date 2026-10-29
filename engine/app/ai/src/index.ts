/**
 * @lumen/app-ai — AI authoring assistant for the Lumen engine.
 *
 * Local-first: the default provider is a deterministic heuristic engine and
 * nothing in this package performs network or filesystem I/O.
 */

export { AIGenerationError, type AIGenerationIssue } from './errors.js';
export {
  HeuristicProvider,
  MockAIProvider,
  STOP_WORDS,
  type AIProvider,
} from './providers.js';
export {
  MOOD_BLUEPRINTS,
  MOOD_KEYWORDS,
  detectChapterCount,
  detectMood,
  extractTitle,
  moodTypeScale,
  tokenize,
  type Mood,
  type MoodBlueprint,
} from './analyze.js';
export {
  generateSceneIRFromDescription,
  inferTemplateKind,
  type GenerateOptions,
} from './generate.js';
export {
  CHAPTER_BOUNDS,
  suggestChapterStructure,
  type ChapterSuggestion,
} from './chapters.js';
export {
  suggestMotionProfiles,
  suggestSceneMotion,
  type MotionSuggestion,
} from './motion.js';
export {
  suggestCameraTracks,
  type CameraKeyframe,
  type CameraMove,
  type CameraSceneRef,
} from './camera.js';
export {
  detectColorwayVariants,
  tagAsset,
  type AssetTags,
  type Colorway,
  type ColorwayGroup,
  type MediaKind,
  type TagAssetInput,
} from './assets.js';
export {
  recommendTemplates,
  type RecommendationInput,
  type TemplateCatalogLike,
  type TemplateRecommendation,
} from './recommend.js';
