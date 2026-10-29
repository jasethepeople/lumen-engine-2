/**
 * @lumen/app-settings — user settings for the Lumen Builder/runtime.
 *
 * Provides:
 *   - UserSettings model + defaults + validation with safe fallbacks,
 *   - SettingsStore: get/set/patch/reset, schema versioning + migration,
 *     change subscription, pluggable storage adapters,
 *   - THEME_PRESETS (muted/warm design language) with lookup helpers,
 *   - resolveReducedMotion() for @lumen/app-runtime's
 *     createLumenApp({ reducedMotion }) seam,
 *   - resolveDeviceClass() honoring a user override,
 *   - MemorySettingsStorage + LocalStorageSettingsAdapter (key
 *     'lumen.settings.v1').
 *
 * Zero runtime dependencies; safe to import under Node (localStorage
 * adapter degrades to no-op persistence outside browsers).
 */

/* ------------------------------------------------------------------ *
 * Device class
 * ------------------------------------------------------------------ */

/**
 * Coarse device classification. Mirrors the capability tiers used across
 * the engine; defined locally because @lumen/contracts does not (yet)
 * export a DeviceClass type.
 */
export type DeviceClass = 'desktop' | 'mobile' | 'low-power';

/** User override for the detected device class; 'auto' = use detected. */
export type DeviceClassOverride = 'auto' | DeviceClass;

/* ------------------------------------------------------------------ *
 * UserSettings model
 * ------------------------------------------------------------------ */

export type ReducedMotionSetting = 'system' | 'on' | 'off';

export interface UserSettings {
  /** Reduced-motion preference; 'system' follows the OS/media query. */
  reducedMotion: ReducedMotionSetting;
  /** Theme preset id (see THEME_PRESETS). */
  themePreset: string;
  /** Device-class override; 'auto' defers to capability detection. */
  deviceClassOverride: DeviceClassOverride;
  /** Optional UI locale (BCP-47 tag, e.g. 'en', 'de-AT'). */
  uiLocale?: string;
}

/** Current persisted schema version. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** Storage key used by LocalStorageSettingsAdapter. */
export const SETTINGS_STORAGE_KEY = 'lumen.settings.v1';

/** Default settings. themePreset defaults to the first preset id. */
export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  reducedMotion: 'system',
  themePreset: 'warm-stone',
  deviceClassOverride: 'auto',
});

const REDUCED_MOTION_VALUES: readonly ReducedMotionSetting[] = ['system', 'on', 'off'];
const DEVICE_CLASS_OVERRIDE_VALUES: readonly DeviceClassOverride[] = [
  'auto',
  'desktop',
  'mobile',
  'low-power',
];

/* ------------------------------------------------------------------ *
 * Theme presets (muted/warm builder design language)
 * ------------------------------------------------------------------ */

export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  accent: string;
  fontFamily: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  tokens: ThemeTokens;
}

/** Built-in theme presets. Order matters: index 0 is the default theme. */
export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  {
    id: 'warm-stone',
    name: 'Warm Stone',
    tokens: {
      background: '#211e1a',
      surface: '#2c2823',
      text: '#ece5d8',
      accent: '#d9a05b',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
  },
  {
    id: 'sand-dune',
    name: 'Sand Dune',
    tokens: {
      background: '#f2ede4',
      surface: '#e7dfd1',
      text: '#3d352b',
      accent: '#b07845',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
  },
  {
    id: 'olive-dusk',
    name: 'Olive Dusk',
    tokens: {
      background: '#232620',
      surface: '#2e3229',
      text: '#e4e6d8',
      accent: '#a8b06a',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
  },
  {
    id: 'terracotta-night',
    name: 'Terracotta Night',
    tokens: {
      background: '#241d1c',
      surface: '#302624',
      text: '#efe4dd',
      accent: '#c96f4a',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
  },
]);

/** Look up a preset by id; undefined when unknown. */
export function getThemePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/** All presets as a fresh array (safe to mutate by the caller). */
export function listThemePresets(): ThemePreset[] {
  return [...THEME_PRESETS];
}

/* ------------------------------------------------------------------ *
 * Validation (safe fallbacks)
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Coerce arbitrary (possibly corrupt) input into a valid UserSettings,
 * falling back field-by-field to defaults. Unknown theme preset ids fall
 * back to the default preset; uiLocale is kept only when a non-empty
 * string.
 */
export function validateUserSettings(input: unknown): UserSettings {
  const src = isRecord(input) ? input : {};
  const settings: UserSettings = {
    reducedMotion: pickEnum(
      src.reducedMotion,
      REDUCED_MOTION_VALUES,
      DEFAULT_USER_SETTINGS.reducedMotion,
    ),
    themePreset:
      typeof src.themePreset === 'string' && getThemePreset(src.themePreset)
        ? src.themePreset
        : DEFAULT_USER_SETTINGS.themePreset,
    deviceClassOverride: pickEnum(
      src.deviceClassOverride,
      DEVICE_CLASS_OVERRIDE_VALUES,
      DEFAULT_USER_SETTINGS.deviceClassOverride,
    ),
  };
  if (typeof src.uiLocale === 'string' && src.uiLocale.length > 0) {
    settings.uiLocale = src.uiLocale;
  }
  return settings;
}

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

/** Shape of a persisted settings payload. */
export interface PersistedSettings {
  version: number;
  settings: UserSettings;
}

/**
 * Migrate a persisted payload of any (or unknown) version to the current
 * schema. Unknown/future/corrupt versions are sanitized through
 * validateUserSettings so the store always ends up with valid data.
 */
export function migrateSettings(raw: unknown): PersistedSettings {
  if (!isRecord(raw)) {
    return { version: SETTINGS_SCHEMA_VERSION, settings: validateUserSettings(undefined) };
  }
  // v1 (and any unrecognized version): sanitize the settings payload.
  const settings = validateUserSettings(raw.settings ?? raw);
  return { version: SETTINGS_SCHEMA_VERSION, settings };
}

/* ------------------------------------------------------------------ *
 * Storage adapters
 * ------------------------------------------------------------------ */

/** Minimal storage contract used by SettingsStore (synchronous). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage (default; also the Node-safe fallback). */
export class MemorySettingsStorage implements SettingsStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * Adapter over window.localStorage. In non-browser environments (or when
 * localStorage throws, e.g. disabled cookies) it degrades to an in-memory
 * store so behavior stays consistent and never crashes.
 */
export class LocalStorageSettingsAdapter implements SettingsStorage {
  private readonly fallback = new MemorySettingsStorage();

  private backend(): SettingsStorage {
    try {
      if (typeof globalThis !== 'undefined') {
        const ls = (globalThis as { localStorage?: SettingsStorage }).localStorage;
        if (ls) return ls;
      }
    } catch {
      /* access itself may throw — fall through */
    }
    return this.fallback;
  }

  getItem(key: string): string | null {
    try {
      return this.backend().getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }
  setItem(key: string, value: string): void {
    try {
      this.backend().setItem(key, value);
    } catch {
      this.fallback.setItem(key, value);
    }
  }
  removeItem(key: string): void {
    try {
      this.backend().removeItem(key);
    } catch {
      this.fallback.removeItem(key);
    }
  }
}

/* ------------------------------------------------------------------ *
 * SettingsStore
 * ------------------------------------------------------------------ */

export type SettingsChangeListener = (
  settings: Readonly<UserSettings>,
  previous: Readonly<UserSettings>,
) => void;

export type Unsubscribe = () => void;

export interface SettingsStoreOptions {
  /** Storage backend; defaults to MemorySettingsStorage. */
  storage?: SettingsStorage;
  /** Storage key; defaults to SETTINGS_STORAGE_KEY. */
  storageKey?: string;
}

/**
 * Versioned, observable settings store. Loads (and migrates) persisted
 * data on construction; every mutation is validated, persisted, and
 * broadcast to subscribers.
 */
export class SettingsStore {
  private readonly storage: SettingsStorage;
  private readonly storageKey: string;
  private readonly listeners = new Set<SettingsChangeListener>();
  private settings: UserSettings;

  constructor(options: SettingsStoreOptions = {}) {
    this.storage = options.storage ?? new MemorySettingsStorage();
    this.storageKey = options.storageKey ?? SETTINGS_STORAGE_KEY;
    this.settings = this.load();
  }

  private load(): UserSettings {
    let raw: unknown = null;
    try {
      const text = this.storage.getItem(this.storageKey);
      raw = text === null ? null : JSON.parse(text);
    } catch {
      raw = null; // corrupt JSON — fall back to defaults
    }
    return migrateSettings(raw).settings;
  }

  private persist(): void {
    const payload: PersistedSettings = {
      version: SETTINGS_SCHEMA_VERSION,
      settings: this.settings,
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      /* persistence is best-effort */
    }
  }

  private commit(next: UserSettings): void {
    const previous = this.settings;
    this.settings = next;
    this.persist();
    for (const listener of [...this.listeners]) {
      listener(Object.freeze({ ...next }), Object.freeze({ ...previous }));
    }
  }

  /** Current settings (defensive copy). */
  get(): UserSettings {
    return { ...this.settings };
  }

  /** Replace all settings (validated). */
  set(settings: unknown): UserSettings {
    const next = validateUserSettings(settings);
    this.commit(next);
    return { ...next };
  }

  /** Merge a partial update (validated). */
  patch(partial: Partial<UserSettings>): UserSettings {
    const next = validateUserSettings({ ...this.settings, ...(partial ?? {}) });
    this.commit(next);
    return { ...next };
  }

  /** Restore defaults. */
  reset(): UserSettings {
    const next = validateUserSettings(undefined);
    this.commit(next);
    return { ...next };
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: SettingsChangeListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/* ------------------------------------------------------------------ *
 * Resolution helpers
 * ------------------------------------------------------------------ */

/**
 * Resolve the effective reduced-motion flag for
 * @lumen/app-runtime's createLumenApp({ reducedMotion }).
 *   'on'     -> true
 *   'off'    -> false
 *   'system' -> systemPrefers (e.g. matchMedia('(prefers-reduced-motion: reduce)'))
 */
export function resolveReducedMotion(
  settings: Pick<UserSettings, 'reducedMotion'>,
  systemPrefers: boolean,
): boolean {
  switch (settings.reducedMotion) {
    case 'on':
      return true;
    case 'off':
      return false;
    default:
      return systemPrefers;
  }
}

/**
 * Resolve the effective device class, honoring the user's override.
 * 'auto' returns the detected class unchanged.
 */
export function resolveDeviceClass(
  settings: Pick<UserSettings, 'deviceClassOverride'>,
  detected: DeviceClass,
): DeviceClass {
  return settings.deviceClassOverride === 'auto' ? detected : settings.deviceClassOverride;
}
