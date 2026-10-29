/**
 * React bindings for the platform service singletons.
 */

import { useEffect, useState } from 'react';
import type { UserSettings } from '@lumen/app-settings';
import { getPlanId, onPlanChange, refreshPlan, settingsStore } from './services';

/** Live user settings, subscribed to the SettingsStore. */
export function useSettings(): UserSettings {
  const [settings, setSettings] = useState<UserSettings>(() => settingsStore.get());
  useEffect(() => settingsStore.subscribe((s) => setSettings({ ...s })), []);
  return settings;
}

/** Live plan id ('free' | 'pro'), refreshed from the billing provider. */
export function usePlanId(): string {
  const [planId, setPlanId] = useState(getPlanId());
  useEffect(() => {
    void refreshPlan().then(setPlanId);
    return onPlanChange(setPlanId);
  }, []);
  return planId;
}

/** System reduced-motion preference via matchMedia. */
export function useSystemPrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setPrefers(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return prefers;
}
