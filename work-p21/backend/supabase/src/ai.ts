/**
 * Hosted AI seam — AI stays LOCAL-ONLY by design (see @lumen/app-ai: the
 * default HeuristicProvider is deterministic and performs zero network I/O).
 * The hosted backend deliberately does not proxy AI to any server; this
 * module simply re-exports the local provider seam so the Builder consumes
 * one facade slot (`backend.ai`) regardless of hosted/offline mode.
 */
export {
  AIGenerationError,
  HeuristicProvider,
  MockAIProvider,
  generateSceneIRFromDescription,
  inferTemplateKind,
  suggestChapterStructure,
  suggestMotionProfiles,
  suggestSceneMotion,
  suggestCameraTracks,
  detectColorwayVariants,
  tagAsset,
  recommendTemplates,
  type AIGenerationIssue,
  type AIProvider,
  type GenerateOptions,
} from '@lumen/app-ai';
