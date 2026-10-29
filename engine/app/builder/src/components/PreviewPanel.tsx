/**
 * Live preview: boots the REAL engine via createLumenApp(config).boot(el).
 *
 * - Debounced re-boot on config change (600 ms); the previous LumenApp is
 *   disposed and its mount node is replaced (bootEngine marks its root with
 *   data-lumen-booted, so each boot gets a fresh element).
 * - Reduced-motion toggle re-boots with BootOptions.reducedMotion threaded
 *   through createLumenApp opts → the runtime's real MotionPolicy seam
 *   (packages/runtime/src/motion.ts) resolves 'reveal' per boot.
 * - Scroll-driven tracks: wheel over the preview feeds the runtime's virtual
 *   scroller (packages/interaction InputNormalizer listens for `wheel` on the
 *   boot root) and scrubs. Time-driven tracks auto-play on the frame loop.
 */

import { useEffect, useRef, useState } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import type { LumenApp } from '@lumen/app-runtime';
import { createLumenApp } from '@lumen/app-runtime';

const DEBOUNCE_MS = 600;

function formatBootError(err: unknown, depth = 0): string {
  if (depth > 5) return '…';
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack ?? ''}`;
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const parts = Object.entries(rec)
      .filter(([k]) => k !== 'cause')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    if ('cause' in rec) parts.push(`cause → ${formatBootError(rec.cause, depth + 1)}`);
    return parts.join('\n');
  }
  return String(err);
}

export interface PreviewPanelProps {
  config: EngineConfig | null;
  /**
   * Optional controlled reduced-motion value (e.g. resolved from
   * @lumen/app-settings via resolveReducedMotion). When provided, the local
   * toggle reflects and reports through onReducedMotionChange instead of
   * internal state.
   */
  reducedMotion?: boolean;
  onReducedMotionChange?: (reduced: boolean) => void;
}

export function PreviewPanel({
  config,
  reducedMotion,
  onReducedMotionChange,
}: PreviewPanelProps) {
  const [localReduced, setLocalReduced] = useState(false);
  const controlled = reducedMotion !== undefined;
  const reduced = controlled ? reducedMotion : localReduced;
  const setReduced = (next: boolean) => {
    if (controlled) onReducedMotionChange?.(next);
    else setLocalReduced(next);
  };
  const [status, setStatus] = useState<'idle' | 'booting' | 'live' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<LumenApp | null>(null);

  useEffect(() => {
    if (!config) {
      setStatus('idle');
      return;
    }
    setStatus('booting');
    const handle = window.setTimeout(() => {
      void (async () => {
        // Dispose previous app and give the next boot a fresh root element.
        appRef.current?.dispose();
        appRef.current = null;
        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = '';
        const mount = document.createElement('div');
        mount.style.position = 'relative';
        mount.style.width = '100%';
        mount.style.height = '100%';
        mount.style.overflow = 'hidden';
        host.appendChild(mount);
        try {
          const app = await createLumenApp(config, { reducedMotion: reduced });
          appRef.current = app;
          await app.boot(mount);
          setError(null);
          setStatus('live');
        } catch (err) {
          setError(formatBootError(err));
          setStatus('error');
        }
      })();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [config, reduced]);

  // Final dispose on unmount.
  useEffect(
    () => () => {
      appRef.current?.dispose();
      appRef.current = null;
    },
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-ink-800">
        <span className="section-title mb-0">Preview</span>
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
            status === 'live'
              ? 'text-emerald-300 border-emerald-900'
              : status === 'error'
                ? 'text-red-300 border-red-900'
                : 'text-ink-400 border-ink-700'
          }`}
        >
          {status}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-300 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-[#8ab4ff]"
            checked={reduced}
            onChange={(e) => setReduced(e.target.checked)}
          />
          Reduced motion
        </label>
      </div>
      <div className="relative flex-1 bg-ink-900">
        <div ref={hostRef} className="absolute inset-0" />
        {status === 'error' && (
          <div className="absolute inset-x-4 top-4 rounded border border-red-900 bg-ink-950/90 p-3">
            <div className="text-[10px] uppercase tracking-wider text-red-300 mb-1">
              Engine boot error
            </div>
            <pre className="text-xs text-red-200 whitespace-pre-wrap font-mono">{error}</pre>
          </div>
        )}
        {!config && (
          <div className="absolute inset-0 grid place-items-center text-ink-400 text-sm">
            Fix the config errors to boot the preview.
          </div>
        )}
        <div className="absolute bottom-3 inset-x-0 text-center pointer-events-none">
          <span className="text-[10px] font-mono text-ink-400 bg-ink-950/70 px-2 py-1 rounded">
            wheel over preview to scrub · time tracks auto-play
          </span>
        </div>
      </div>
    </div>
  );
}
