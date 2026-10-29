/**
 * Export panel — honest about what runs in the browser:
 *
 *  - Download / copy the EngineConfig JSON.                         (client)
 *  - Download the lowered SceneIR document (real @lumen/codegen
 *    lowerToIR seam, run in-browser).                               (client)
 *  - Run real @lumen/codegen generate() in-browser and download the
 *    emitted static entry module + SSR HTML.                        (client)
 *  - The bundling/asset-pipeline step (packages/build) needs Node —
 *    we show the exact CLI command instead of faking it.
 */

import { useState } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import { createExtendedRegistry } from '@lumen/templates';
import { generate, lowerToIR, serializeIR } from '@lumen/codegen';
import { manifestFromAssetRefs } from '@lumen/runtime';

function download(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface GeneratedFile {
  path: string;
  source: string;
}

export function ExportPanel({ config, text }: { config: EngineConfig; text: string }) {
  const [copied, setCopied] = useState(false);
  const [files, setFiles] = useState<GeneratedFile[] | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const buildArtifacts = () => {
    const registry = createExtendedRegistry();
    const descriptor = registry.require(config.template);
    const manifest = manifestFromAssetRefs(
      config.assets.map((a) => ({
        id: a.id,
        src: a.src,
        kind: a.kind,
        ...(a.preload !== undefined ? { preload: a.preload } : {}),
        ...(a.duration !== undefined ? { duration: a.duration } : {}),
      })),
    );
    const scene = descriptor.compose(config, manifest);
    const ir = lowerToIR(config, descriptor.themeTokens, scene, manifest);
    return { descriptor, scene, manifest, ir };
  };

  const onDownloadIR = () => {
    try {
      const { ir } = buildArtifacts();
      download('scene.ir.json', serializeIR(ir));
      setGenError(null);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    }
  };

  const onGenerate = () => {
    try {
      const { descriptor, scene, manifest } = buildArtifacts();
      const result = generate(
        config,
        descriptor,
        scene,
        { target: config.build, emitTypeScript: false },
        manifest,
      );
      const out: GeneratedFile[] = result.files.map((f) => ({
        path: f.path,
        source: f.source,
      }));
      if (result.ssrHtml) out.push({ path: 'index.ssr.html', source: result.ssrHtml });
      setFiles(out);
      setGenError(null);
    } catch (err) {
      setFiles(null);
      setGenError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="border-t border-ink-800 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="section-title mb-0 mr-2">Export</span>
        <button className="btn" onClick={() => download('engine.config.json', text)}>
          Download config
        </button>
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied!' : 'Copy config'}
        </button>
        <button className="btn" onClick={onDownloadIR}>
          Download SceneIR
        </button>
        <button className="btn-primary" onClick={onGenerate}>
          Generate static modules
        </button>
      </div>
      {genError && (
        <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap">{genError}</pre>
      )}
      {files && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-400">
            Generated {files.length} file(s) — download individually:
          </div>
          {files.map((f) => (
            <button
              key={f.path}
              className="block w-full text-left font-mono text-xs text-accent hover:underline truncate"
              onClick={() => download(f.path.split('/').pop() ?? f.path, f.source, 'text/plain')}
            >
              {f.path} <span className="text-ink-400">({f.source.length} B)</span>
            </button>
          ))}
        </div>
      )}
      <div className="text-[11px] text-ink-400 font-mono leading-relaxed">
        Full static-site build (bundling + asset pipeline) runs in Node, not the browser:
        <br />
        <span className="text-ink-300">
          bash scripts/build-all.sh && node app/cli/dist/index.js build engine.config.json --out
          dist
        </span>
      </div>
    </div>
  );
}
