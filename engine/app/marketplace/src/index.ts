/**
 * @lumen/app-marketplace — public API.
 * Template marketplace core: metadata model, pluggable catalog, search,
 * install/update flows and installed-template stores. Framework-free.
 */

export {
  CATEGORIES,
  isSemver,
  makeThumbnail,
  type Category,
  type TemplateMeta,
  type TemplateTier,
} from './meta.js';
export {
  BuiltinSource,
  TemplateCatalog,
  type CategoryCount,
  type MarketplaceSource,
  type SearchFilters,
} from './catalog.js';
export { BUILTIN_TEMPLATES } from './builtin.js';
export {
  compareSemver,
  type InstallResult,
  LocalStorageInstalledTemplatesStore,
  Marketplace,
  MemoryInstalledTemplatesStore,
  TemplateValidationError,
  validateTemplateMeta,
  type InstalledTemplate,
  type InstalledTemplatesStore,
  type StorageLike,
  type TemplateUpdate,
} from './install.js';

// --- Phase 15: monetization (additive) ---
export {
  getPricedTemplate,
  isPaidTemplateMeta,
  encodePrice,
  withPrice,
  PRICED_TEMPLATES,
  type PaidTemplateMeta,
  type TemplatePrice,
} from './paid.js';
export {
  LocalStoragePurchaseStore,
  MemoryPurchaseStore,
  MockTemplateBillingProvider,
  PurchaseError,
  TemplatePurchases,
  type Purchase,
  type PurchaseClock,
  type PurchaseStorageLike,
  type PurchaseStore,
  type TemplateBillingProvider,
  type TemplateChargeReceipt,
} from './purchases.js';
export {
  CreatorOwnershipError,
  CreatorSource,
  CreatorTemplateService,
  CreatorTemplateValidationError,
  LocalStorageCreatorTemplateStore,
  MemoryCreatorTemplateStore,
  validateCreatorTemplate,
  type CreatorMetaPatch,
  type CreatorStorageLike,
  type CreatorTemplateInput,
  type CreatorTemplateRecord,
  type CreatorTemplateStore,
  type PreviewDescriptor,
} from './creator.js';
