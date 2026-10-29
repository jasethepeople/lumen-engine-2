/**
 * tests/saas-smoke — (a) onboarding wizard → buildConfig → createProjectFromWizard.
 *
 * Offline end-to-end through the REAL local packages: the wizard drives the
 * same @lumen/app-onboarding step machine the Builder renders, and the
 * project lands in the offline backend facade's real ProjectStore
 * (@lumen/app-projects over MemoryStorage — exactly what
 * createOfflineBackend() wires). No network, no mocks beyond deterministic
 * id/clock seams.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import { createBackend, createOfflineBackend } from '@lumen/backend-supabase';
import {
  OnboardingWizard,
  RuntimeTemplateProvider,
  buildConfig,
  createProjectFromWizard,
} from '@lumen/app-onboarding';

function walkWizard(wizard) {
  assert.equal(wizard.start().stepId, 'welcome');
  assert.equal(wizard.next().state.stepId, 'choose-template');
  assert.ok(wizard.next({ templateId: 'scroll-cinema-landing' }).ok);
  assert.ok(wizard.next({ heroMedia: [{ name: 'hero.mp4', kind: 'video' }] }).ok);
  assert.ok(
    wizard.next({
      chapters: [
        { id: 'ch-1', title: 'Opening' },
        { id: 'ch-2', title: 'Closer', duration: 2000 },
      ],
    }).ok,
  );
  assert.ok(wizard.next({ themeId: 'warm-stone' }).ok);
  assert.ok(wizard.next({ motionPref: 'reveal' }).ok);
  assert.equal(wizard.state().stepId, 'first-publish');
  return wizard;
}

test('smoke: createBackend({}) auto-selects offline (no VITE_SUPABASE_* env)', () => {
  const backend = createBackend({});
  assert.equal(backend.mode, 'offline');
  assert.equal(backend.telemetry.stats().enabled, false);
});

test('(a) onboarding wizard → buildConfig → createProjectFromWizard', async () => {
  const backend = createOfflineBackend();
  const templateProvider = new RuntimeTemplateProvider();
  assert.ok(
    templateProvider.list().some((t) => t.id === 'scroll-cinema-landing'),
    'runtime template provider lists the builtin scroll template',
  );

  const wizard = walkWizard(new OnboardingWizard({ templateProvider }));

  // buildConfig produces a config that passes the real parseConfig seam.
  const config = buildConfig(wizard.state(), { templateProvider, id: 'smoke-onboarding' });
  assert.equal(config.template, 'scroll-video');
  assert.equal(config.scenes.length, 2);
  assert.equal(config.assets.length, 1);
  assert.equal(config.assets[0].kind, 'video');
  const parsed = parseConfig(config);
  assert.ok(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.errors));

  // Persisted through the offline backend's real ProjectStore.
  assert.equal(wizard.checklistStatus()['project saved'], false);
  const project = await createProjectFromWizard(backend.projects, wizard, {
    templateProvider,
    name: 'Smoke Onboarding Project',
  });
  assert.equal(project.name, 'Smoke Onboarding Project');
  assert.equal(project.templateKind, 'scroll-video');
  assert.equal(project.templateId, 'scroll-cinema-landing');
  assert.equal(wizard.checklistStatus()['project saved'], true);

  const listed = await backend.projects.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, project.id);
  assert.ok(parseConfig(listed[0].config).ok, 'stored config round-trips parseConfig');

  // Wizard can now complete against the real checklist.
  assert.equal(wizard.next({ publishTarget: 'lumen.hosting' }).ok, true);
  assert.equal(wizard.state().done, true);
});
