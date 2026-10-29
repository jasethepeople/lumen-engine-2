/**
 * PublishPanel — real publish flow over @lumen/app-publish:
 * PublishService.publish (StaticExporter → budgets → MockVercelClient →
 * history), entitlement gate wired to EntitlementService over the
 * MockBillingProvider subscription ('publish.vercel' is pro-only), publish
 * URL, per-project history, and rollback.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Project } from '@lumen/app-projects';
import type { EngineConfig } from '@lumen/contracts';
import { BudgetExceededError, type PublishRecord } from '@lumen/app-publish';
import { isEntitlementDeniedError } from '@lumen/app-entitlements';
import { publishService, telemetry } from '../platform/services';
import { usePlanId } from '../platform/hooks';

export interface PublishPanelProps {
  /** Project to publish (open in the editor). */
  project: Project | null;
  /** Current editor config (published when it differs from the saved one). */
  currentConfig: EngineConfig | null;
  /** Offer to save the editor config as a project when none is open. */
  onSaveAsProject(): void;
}

export function PublishPanel({ project, currentConfig, onSaveAsProject }: PublishPanelProps) {
  const [history, setHistory] = useState<PublishRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeNeeded, setUpgradeNeeded] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const planId = usePlanId();

  const refresh = useCallback(() => {
    if (!project) {
      setHistory([]);
      return;
    }
    setHistory(publishService.listHistory(project.id));
  }, [project]);

  useEffect(refresh, [refresh]);

  const publish = async () => {
    if (!project) return;
    setBusy(true);
    setError(null);
    setUpgradeNeeded(null);
    try {
      const config = (currentConfig ?? project.config) as EngineConfig;
      const result = await publishService.publish({
        id: project.id,
        name: project.name,
        config,
      });
      telemetry.track('builder.project.published', {
        projectId: project.id,
        deploymentId: result.record.deploymentId,
      });
      setLastUrl(result.record.url);
      refresh();
    } catch (err) {
      if (isEntitlementDeniedError(err)) {
        setUpgradeNeeded(err.requiredPlan);
      } else if (err instanceof BudgetExceededError) {
        setError(
          `Bundle exceeds size budgets:\n${err.violations
            .map((v) => `  ${v.metric}: ${(v.actual / 1024).toFixed(1)} KB > ${(v.budget / 1024).toFixed(1)} KB`)
            .join('\n')}`,
        );
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (recordId: string) => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const record = await publishService.rollback(project.id, recordId);
      setLastUrl(record.url);
      refresh();
    } catch (err) {
      if (isEntitlementDeniedError(err)) setUpgradeNeeded(err.requiredPlan);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!project) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="card max-w-xl mx-auto space-y-3">
          <h2 className="section-title mb-0">Publish</h2>
          <p className="text-sm text-ink-300">
            Publishing works on a saved project — its history and rollback snapshots are
            tracked per project.
          </p>
          <button className="btn-primary text-xs" onClick={onSaveAsProject}>
            Save current editor config as a project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="section-title mb-0">Publish — {project.name}</h2>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-ink-700 text-ink-300">
          plan: {planId}
        </span>
        <button
          className="btn-primary text-xs ml-auto disabled:opacity-40"
          disabled={busy}
          onClick={() => void publish()}
        >
          {busy ? 'Publishing…' : 'Publish to vercel (mock)'}
        </button>
      </div>

      {upgradeNeeded && (
        <div className="rounded border border-amber-900 bg-ink-950 p-4 space-y-2">
          <div className="text-sm text-amber-200 font-semibold">
            Publishing requires the {upgradeNeeded} plan
          </div>
          <p className="text-xs text-ink-300">
            The entitlement <code className="font-mono">publish.vercel</code> is not included
            in your current plan ({planId}). Switch to the {upgradeNeeded} plan in the
            Settings tab (mock billing — no payment) to enable publishing.
          </p>
        </div>
      )}
      {error && (
        <pre className="rounded border border-red-900 bg-ink-950 p-3 text-xs text-red-200 font-mono whitespace-pre-wrap">
          {error}
        </pre>
      )}
      {lastUrl && (
        <div className="rounded border border-emerald-900 bg-ink-950 p-3 text-sm">
          <span className="text-emerald-200">Live: </span>
          <a className="font-mono text-accent underline" href={`https://${lastUrl}`} target="_blank" rel="noreferrer">
            {lastUrl}
          </a>
          <span className="text-[10px] text-ink-400 ml-2">(mock deployment — no network)</span>
        </div>
      )}

      <div className="card">
        <div className="section-title">History ({history.length})</div>
        {history.length === 0 && (
          <p className="text-sm text-ink-400">
            No publishes yet. Each publish keeps a full bundle snapshot so any record can be
            rolled back.
          </p>
        )}
        <ul className="divide-y divide-ink-800">
          {[...history].reverse().map((rec) => (
            <li key={rec.id} className="py-2 flex items-center gap-3 flex-wrap">
              <div>
                <div className="text-sm font-mono text-ink-100">{rec.url}</div>
                <div className="text-[10px] font-mono text-ink-400">
                  {rec.deploymentId} · hash {rec.configHash.slice(0, 12)} ·{' '}
                  {new Date(rec.publishedAt).toLocaleString()}
                </div>
              </div>
              <span
                className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                  rec.status === 'live'
                    ? 'text-emerald-300 border-emerald-900'
                    : 'text-ink-400 border-ink-700'
                }`}
              >
                {rec.status}
              </span>
              <button
                className="btn text-xs ml-auto disabled:opacity-40"
                disabled={busy}
                title="Redeploy this record's bundle snapshot"
                onClick={() => void rollback(rec.id)}
              >
                Roll back to this
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
