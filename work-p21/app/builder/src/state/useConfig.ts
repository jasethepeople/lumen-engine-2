/**
 * Central config state for the builder.
 *
 * Source of truth is the raw JSONC text (the "raw JSON" view). Form editors
 * parse it via the REAL @lumen/config parseConfig seam, mutate the validated
 * EngineConfig, and re-serialize — so every form edit round-trips through the
 * same validation pipeline the CLI uses, and path-aware ValidationErrors are
 * surfaced verbatim in the raw view.
 */

import { useCallback, useMemo, useState } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import { parseConfig, type ParseConfigResult } from '@lumen/config';
import starterText from '../../../../examples/simple-site/engine.config.json?raw';

export interface ConfigState {
  /** Current raw JSONC source. */
  text: string;
  /** Latest parse result (ok or errors). */
  parsed: ParseConfigResult;
  /** Validated config when parse succeeds, else the last good one. */
  config: EngineConfig | null;
  /** Replace the raw text (raw JSON editor, template switch). */
  setText(text: string): void;
  /** Apply a mutation to the validated config and re-serialize. */
  update(mutate: (cfg: EngineConfig) => void): void;
  /** True when the current text parses cleanly. */
  valid: boolean;
}

function serialize(cfg: EngineConfig): string {
  return JSON.stringify(cfg, null, 2) + '\n';
}

export function useConfigState(): ConfigState {
  const [text, setTextState] = useState<string>(starterText);
  const [lastGood, setLastGood] = useState<EngineConfig | null>(() => {
    const r = parseConfig(starterText);
    return r.ok ? r.config : null;
  });

  const parsed = useMemo(() => parseConfig(text), [text]);
  const valid = parsed.ok;
  const config = valid ? parsed.config : lastGood;

  const setText = useCallback((next: string) => {
    setTextState(next);
    const r = parseConfig(next);
    if (r.ok) setLastGood(r.config);
  }, []);

  const update = useCallback((mutate: (cfg: EngineConfig) => void) => {
    setTextState((prev) => {
      const pr = parseConfig(prev);
      const base = pr.ok ? pr.config : null;
      if (!base) return prev; // raw buffer invalid and unrecoverable; wait
      const draft = JSON.parse(JSON.stringify(base)) as EngineConfig;
      mutate(draft);
      const next = serialize(draft);
      const r = parseConfig(next);
      if (r.ok) setLastGood(r.config);
      return next;
    });
  }, []);

  return { text, parsed, config, setText, update, valid };
}
