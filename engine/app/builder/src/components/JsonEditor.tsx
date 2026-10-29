/**
 * Raw JSON view: direct JSONC editing with path-aware validation errors
 * surfaced from the real @lumen/config parseConfig seam, plus non-fatal
 * template-slot warnings from the real @lumen/templates registry.
 */

import { useMemo } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import type { ParseConfigResult } from '@lumen/config';
import { createExtendedRegistry } from '@lumen/templates';

export function JsonEditor({
  text,
  parsed,
  config,
  setText,
}: {
  text: string;
  parsed: ParseConfigResult;
  config: EngineConfig | null;
  setText(t: string): void;
}) {
  const warnings = useMemo(() => {
    if (!parsed.ok || !config) return [];
    try {
      return createExtendedRegistry().validate(config).warnings;
    } catch {
      return [];
    }
  }, [parsed, config]);

  return (
    <div className="flex flex-col h-full">
      <textarea
        className="flex-1 w-full font-mono text-xs leading-relaxed bg-ink-950 border-0 rounded-none resize-none p-3 focus:border-0"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="border-t border-ink-800 max-h-48 overflow-y-auto">
        {!parsed.ok &&
          parsed.errors.map((e, i) => (
            <div key={i} className="px-3 py-1.5 text-xs font-mono border-b border-ink-850">
              <span className="text-red-300">{e.path || '(root)'}</span>
              <span className="text-ink-300"> — {e.message}</span>
            </div>
          ))}
        {parsed.ok && warnings.length === 0 && (
          <div className="px-3 py-2 text-xs text-emerald-300 font-mono">
            config valid · no template warnings
          </div>
        )}
        {parsed.ok &&
          warnings.map((w, i) => (
            <div key={i} className="px-3 py-1.5 text-xs font-mono border-b border-ink-850">
              <span className="text-amber-300">warning {w.path}</span>
              <span className="text-ink-300"> — {w.message}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
