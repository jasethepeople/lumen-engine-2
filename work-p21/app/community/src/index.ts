/**
 * @lumen/app-community — public API.
 * Creator community & social layer: profiles, template/project showcases,
 * remix flow with attribution, and threaded local-only comments.
 */

export {
  HANDLE_PATTERN,
  ProfileError,
  ProfileStore,
  avatarColorFor,
  validateHandle,
  type CreateProfileInput,
  type CreatorProfile,
  type ProfileStoreOptions,
  type UpdateProfilePatch,
} from './profile.js';
export {
  CommunityShowcase,
  ShowcaseValidationError,
  type CommunityShowcaseOptions,
  type ProjectShowcaseEntry,
  type ShowcaseFilters,
  type ShowcaseProjectInput,
  type TemplateShowcaseEntry,
} from './showcase.js';
export {
  RemixError,
  RemixService,
  type RemixRecord,
  type RemixServiceOptions,
} from './remix.js';
export {
  COMMENTS_PER_TARGET_CAP,
  COMMENT_MAX_LENGTH,
  COMMENT_MIN_LENGTH,
  CommentError,
  CommentService,
  type Comment,
  type CommentNode,
  type CommentServiceOptions,
} from './comments.js';
export {
  LocalStorageCommunityStorage,
  MemoryCommunityStorage,
  defaultCommunityStorage,
  type StorageLike,
} from './storage.js';
