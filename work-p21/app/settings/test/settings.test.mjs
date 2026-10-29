/**
 * @lumen/app-settings — headless tests.
 *
 * Covers defaults, patch/reset, subscription, persistence round-trip,
 * schema migration (incl. unknown versions), corrupt-data fallback,
 * the reduced-motion resolution matrix, device-class override, and the
 * theme preset helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USER_SETTINGS,
  LocalStorageSettingsAdapter,
  MemorySettingsStorage,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  SettingsStore,
  THEME_PRESETS,
  getThemePreset,
  listThemePresets,
  migrateSettings,
  resolveDeviceClass,
  resolveReducedMotion,
  validateUserSettings,
} from '../dist/index.js';

test('defaults: a fresh store returns DEFAULT_USER_SETTINGS', () => {
  const store = new SettingsStore();
  assert.deepEqual(store.get(), DEFAULT_USER_SETTINGS);
  assert.equal(store.get().reducedMotion, 'system');
  assert.equal(store.get().deviceClassOverride, 'auto');
  assert.equal(store.get().themePreset, THEME_PRESETS[0].id);
  assert.equal(store.get().uiLocale, undefined);
});

test('patch: merges a partial update and persists it', () => {
  const storage = new MemorySettingsStorage();
  const store = new SettingsStore({ storage });
  const next = store.patch({ reducedMotion: 'on', uiLocale: 'de-AT' });
  assert.equal(next.reducedMotion, 'on');
  assert.equal(next.uiLocale, 'de-AT');
  assert.equal(next.themePreset, DEFAULT_USER_SETTINGS.themePreset);

  // Round-trip: a second store on the same storage sees the patch.
  const reloaded = new SettingsStore({ storage });
  assert.equal(reloaded.get().reducedMotion, 'on');
  assert.equal(reloaded.get().uiLocale, 'de-AT');

  // Persisted payload carries the schema version.
  const persisted = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY));
  assert.equal(persisted.version, SETTINGS_SCHEMA_VERSION);
});

test('set: replaces the whole settings object (validated)', () => {
  const store = new SettingsStore();
  store.set({
    reducedMotion: 'off',
    themePreset: 'olive-dusk',
    deviceClassOverride: 'mobile',
    uiLocale: 'fr',
  });
  assert.deepEqual(store.get(), {
    reducedMotion: 'off',
    themePreset: 'olive-dusk',
    deviceClassOverride: 'mobile',
    uiLocale: 'fr',
  });
});

test('reset: restores defaults after mutations', () => {
  const store = new SettingsStore();
  store.patch({ reducedMotion: 'on', deviceClassOverride: 'low-power', uiLocale: 'ja' });
  const reset = store.reset();
  assert.deepEqual(reset, DEFAULT_USER_SETTINGS);
  assert.deepEqual(store.get(), DEFAULT_USER_SETTINGS);
});

test('subscription: listener receives (next, previous) and unsubscribe works', () => {
  const store = new SettingsStore();
  const calls = [];
  const unsubscribe = store.subscribe((next, previous) => calls.push({ next, previous }));

  store.patch({ reducedMotion: 'on' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].next.reducedMotion, 'on');
  assert.equal(calls[0].previous.reducedMotion, 'system');

  store.reset();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].next.reducedMotion, 'system');
  assert.equal(calls[1].previous.reducedMotion, 'on');

  unsubscribe();
  store.patch({ reducedMotion: 'off' });
  assert.equal(calls.length, 2, 'no calls after unsubscribe');

  // Multiple subscribers each fire once.
  let a = 0;
  let b = 0;
  store.subscribe(() => a++);
  store.subscribe(() => b++);
  store.patch({ themePreset: 'sand-dune' });
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('migration: unknown/legacy versions are migrated to the current schema', () => {
  const v0 = migrateSettings({
    version: 0,
    settings: { reducedMotion: 'on', theme: 'legacy-field' },
  });
  assert.equal(v0.version, SETTINGS_SCHEMA_VERSION);
  assert.equal(v0.settings.reducedMotion, 'on');
  assert.equal(v0.settings.themePreset, DEFAULT_USER_SETTINGS.themePreset);

  // Future version with valid payload still sanitized to current schema.
  const future = migrateSettings({
    version: 99,
    settings: { deviceClassOverride: 'low-power', uiLocale: 'en-GB' },
  });
  assert.equal(future.version, SETTINGS_SCHEMA_VERSION);
  assert.equal(future.settings.deviceClassOverride, 'low-power');
  assert.equal(future.settings.uiLocale, 'en-GB');

  // Garbage in -> defaults out.
  assert.deepEqual(migrateSettings(null).settings, DEFAULT_USER_SETTINGS);
  assert.deepEqual(migrateSettings('nope').settings, DEFAULT_USER_SETTINGS);
});

test('corrupt data: invalid JSON and invalid fields fall back safely', () => {
  const storage = new MemorySettingsStorage();
  storage.setItem(SETTINGS_STORAGE_KEY, '{not json');
  const store = new SettingsStore({ storage });
  assert.deepEqual(store.get(), DEFAULT_USER_SETTINGS);

  storage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      settings: {
        reducedMotion: 'loud',
        themePreset: 'does-not-exist',
        deviceClassOverride: 'toaster',
        uiLocale: 42,
      },
    }),
  );
  const store2 = new SettingsStore({ storage });
  assert.deepEqual(store2.get(), DEFAULT_USER_SETTINGS);

  // Field-level: valid fields survive, invalid ones fall back.
  const partial = validateUserSettings({ reducedMotion: 'off', themePreset: 'bogus' });
  assert.equal(partial.reducedMotion, 'off');
  assert.equal(partial.themePreset, DEFAULT_USER_SETTINGS.themePreset);
});

test('reduced-motion resolution matrix', () => {
  assert.equal(resolveReducedMotion({ reducedMotion: 'on' }, false), true);
  assert.equal(resolveReducedMotion({ reducedMotion: 'on' }, true), true);
  assert.equal(resolveReducedMotion({ reducedMotion: 'off' }, false), false);
  assert.equal(resolveReducedMotion({ reducedMotion: 'off' }, true), false);
  assert.equal(resolveReducedMotion({ reducedMotion: 'system' }, true), true);
  assert.equal(resolveReducedMotion({ reducedMotion: 'system' }, false), false);
});

test('device-class override: auto defers to detected, override wins', () => {
  for (const detected of ['desktop', 'mobile', 'low-power']) {
    assert.equal(resolveDeviceClass({ deviceClassOverride: 'auto' }, detected), detected);
  }
  assert.equal(resolveDeviceClass({ deviceClassOverride: 'mobile' }, 'desktop'), 'mobile');
  assert.equal(resolveDeviceClass({ deviceClassOverride: 'low-power' }, 'mobile'), 'low-power');
  assert.equal(resolveDeviceClass({ deviceClassOverride: 'desktop' }, 'low-power'), 'desktop');
});

test('theme presets: at least 4 presets with full token sets', () => {
  const presets = listThemePresets();
  assert.ok(presets.length >= 4);
  for (const preset of presets) {
    assert.ok(preset.id.length > 0);
    assert.ok(preset.name.length > 0);
    for (const key of ['background', 'surface', 'text', 'accent', 'fontFamily']) {
      assert.equal(typeof preset.tokens[key], 'string', `${preset.id}.${key}`);
      assert.ok(preset.tokens[key].length > 0, `${preset.id}.${key}`);
    }
  }
  assert.equal(getThemePreset('warm-stone').name, 'Warm Stone');
  assert.equal(getThemePreset('nope'), undefined);
  assert.equal(THEME_PRESETS.length, presets.length);
});

test('LocalStorageSettingsAdapter: works under Node via in-memory fallback', () => {
  const storage = new LocalStorageSettingsAdapter();
  const store = new SettingsStore({ storage });
  store.patch({ themePreset: 'terracotta-night' });
  // Same adapter instance -> data visible (fallback memory store).
  const reloaded = new SettingsStore({ storage });
  assert.equal(reloaded.get().themePreset, 'terracotta-night');
});
