/**
 * SettingsPanel — real @lumen/app-settings store UI:
 * reduced-motion preference (system/on/off, resolved into the preview's
 * createLumenApp reducedMotion option by App), theme preset picker applying
 * tokens to the builder chrome, device-class override, telemetry opt-in
 * toggle (default off; gates TelemetryClient.track), and the mock plan
 * switcher (free/pro via MockBillingProvider) that drives entitlement gating.
 */

import { useEffect, useState } from 'react';
import {
  THEME_PRESETS,
  type DeviceClassOverride,
  type ReducedMotionSetting,
} from '@lumen/app-settings';
import { FREE_PLAN_ID, PLANS, PRO_PLAN_ID, type Subscription } from '@lumen/app-billing';
import { ENTITLEMENT_KEYS } from '@lumen/app-entitlements';
import {
  USER_ID,
  billing,
  detectCurrentDeviceClass,
  entitlements,
  settingsStore,
  switchPlan,
  telemetry,
} from '../platform/services';
import { usePlanId, useSettings } from '../platform/hooks';

export function SettingsPanel() {
  const settings = useSettings();
  const planId = usePlanId();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [telemetryOn, setTelemetryOn] = useState(telemetry.enabled);
  const [eventCount, setEventCount] = useState(telemetry.stats().recorded);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void billing.getSubscription(USER_ID).then(setSubscription);
  }, [planId]);

  const patch = (partial: Parameters<typeof settingsStore.patch>[0]) => {
    settingsStore.patch(partial);
  };

  const toggleTelemetry = (on: boolean) => {
    telemetry.setEnabled(on);
    setTelemetryOn(telemetry.enabled);
    setEventCount(telemetry.stats().recorded);
  };

  const choosePlan = async (next: string) => {
    setBusy(true);
    try {
      await switchPlan(next);
    } finally {
      setBusy(false);
    }
  };

  const deviceClass = detectCurrentDeviceClass();

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5 max-w-3xl mx-auto">
      <h2 className="section-title mb-0">Settings</h2>

      {/* Motion */}
      <div className="card space-y-2">
        <div className="section-title mb-1">Motion</div>
        <label className="field-label" htmlFor="rm-select">
          Reduced motion
        </label>
        <select
          id="rm-select"
          value={settings.reducedMotion}
          onChange={(e) => patch({ reducedMotion: e.target.value as ReducedMotionSetting })}
        >
          <option value="system">system — follow the OS preference</option>
          <option value="on">on — always reduce motion</option>
          <option value="off">off — full motion</option>
        </select>
        <p className="text-[11px] text-ink-400">
          Resolved via resolveReducedMotion() and fed into the preview's createLumenApp
          reducedMotion option. Scene-level a11y.motion defaults still win (engine
          semantics).
        </p>
      </div>

      {/* Theme */}
      <div className="card space-y-2">
        <div className="section-title mb-1">Builder theme</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`card text-left transition-colors ${
                settings.themePreset === p.id ? 'border-accent/60' : 'hover:border-ink-600'
              }`}
              onClick={() => patch({ themePreset: p.id })}
            >
              <div className="text-sm text-ink-100">{p.name}</div>
              <div className="flex gap-1.5 mt-2">
                {[p.tokens.background, p.tokens.surface, p.tokens.text, p.tokens.accent].map(
                  (color) => (
                    <span
                      key={color}
                      className="w-6 h-6 rounded border border-ink-700"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ),
                )}
              </div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-400">
          The selected preset's tokens are applied to the builder chrome (shell background,
          surfaces, text, accent, font).
        </p>
      </div>

      {/* Device class */}
      <div className="card space-y-2">
        <div className="section-title mb-1">Device class</div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={settings.deviceClassOverride}
            onChange={(e) =>
              patch({ deviceClassOverride: e.target.value as DeviceClassOverride })
            }
          >
            <option value="auto">auto — detect from navigator signals</option>
            <option value="desktop">desktop</option>
            <option value="mobile">mobile</option>
            <option value="low-power">low-power</option>
          </select>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-ink-700 text-ink-300">
            effective: {deviceClass}
          </span>
        </div>
        <p className="text-[11px] text-ink-400">
          Drives the asset pipeline profile shown in the Assets tab
          (resolveDeviceClass over detectDeviceClass).
        </p>
      </div>

      {/* Telemetry */}
      <div className="card space-y-2">
        <div className="section-title mb-1">Telemetry</div>
        <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-[#8ab4ff]"
            checked={telemetryOn}
            onChange={(e) => toggleTelemetry(e.target.checked)}
          />
          Opt in to local-only product telemetry
        </label>
        <p className="text-[11px] text-ink-400">
          Default off. When on, the builder records project-created,
          template-installed and publish events via TelemetryClient.track into a local
          ring buffer ({eventCount} recorded this session) — zero network calls,
          sanitized props.
        </p>
        {telemetryOn && (
          <div className="flex gap-2">
            <button
              className="btn text-xs"
              onClick={() => {
                const blob = new Blob([telemetry.exportEvents()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'lumen-telemetry.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export events
            </button>
            <button
              className="btn text-xs"
              onClick={() => {
                telemetry.clear();
                setEventCount(0);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Plan switcher (mock billing) */}
      <div className="card space-y-2">
        <div className="section-title mb-1">Plan (mock billing)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[FREE_PLAN_ID, PRO_PLAN_ID].map((id) => {
            const plan = PLANS[id];
            const active = planId === id;
            return (
              <button
                key={id}
                disabled={busy || active}
                className={`card text-left transition-colors disabled:opacity-60 ${
                  active ? 'border-accent/60' : 'hover:border-ink-600'
                }`}
                onClick={() => void choosePlan(id)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink-100">{plan?.name ?? id}</span>
                  {active && (
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-emerald-900 text-emerald-300">
                      current
                    </span>
                  )}
                  <span className="text-xs text-ink-400 ml-auto">
                    ${((plan?.priceMonthly ?? 0) / 100).toFixed(0)}/mo
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5">
                  {(plan?.features ?? []).map((f) => (
                    <li key={f} className="text-[11px] text-ink-400">
                      · {f}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        {subscription && (
          <p className="text-[11px] text-ink-400">
            subscription: {subscription.planId} ({subscription.status}) · entitlements:{' '}
            {ENTITLEMENT_KEYS.filter((k) => entitlements.can(k)).join(', ') || 'none'}
          </p>
        )}
        <p className="text-[11px] text-ink-400">
          MockBillingProvider checkout completes instantly and persists locally; the
          EntitlementService re-resolves gating immediately (try publishing on the free
          plan).
        </p>
      </div>

      <button className="btn text-xs" onClick={() => settingsStore.reset()}>
        Reset all settings to defaults
      </button>
    </div>
  );
}
