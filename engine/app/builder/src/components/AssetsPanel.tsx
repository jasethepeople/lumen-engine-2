/**
 * AssetsPanel — real asset pipeline UI over @lumen/app-assets:
 * file upload → AssetUploadQueue (per-job status + per-op progress),
 * device-class badge + pipeline profile (detectDeviceClass /
 * pickPipelineProfile honoring the settings override), hybrid manifest
 * variants on completion (HybridManifestGenerator + AssetLibrary), the
 * FfmpegUnavailableError state with guidance, and a small player preview.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HybridManifestGenerator,
  pickPipelineProfile,
  type AssetJobRecord,
  type AssetJobState,
  type ProcessedSource,
} from '@lumen/app-assets';
import {
  assetLibrary,
  assetQueue,
  detectCurrentDeviceClass,
} from '../platform/services';
import { useSettings } from '../platform/hooks';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

interface HeldBytes {
  kind: 'video' | 'image';
  sourceName: string;
  bytes: Uint8Array;
}

const STATE_STYLE: Record<AssetJobState, string> = {
  pending: 'text-ink-300 border-ink-700',
  running: 'text-accent border-accent/40',
  done: 'text-emerald-300 border-emerald-900',
  failed: 'text-red-300 border-red-900',
  canceled: 'text-ink-400 border-ink-700',
};

export function AssetsPanel() {
  const [jobs, setJobs] = useState<AssetJobRecord[]>(() => assetQueue.listJobs());
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [preview, setPreview] = useState<{ url: string; kind: 'video' | 'image'; name: string } | null>(null);
  const held = useRef(new Map<string, HeldBytes>());
  const settings = useSettings();
  const deviceClass = useMemo(() => detectCurrentDeviceClass(), [settings]);
  const profile = useMemo(() => pickPipelineProfile(deviceClass), [deviceClass]);
  const generator = useMemo(() => new HybridManifestGenerator(), []);

  useEffect(
    () =>
      assetQueue.onProgress(() => {
        setJobs(assetQueue.listJobs());
      }),
    [],
  );

  // Revoke preview object URLs on change/unmount.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  // When a job reaches 'done', build the hybrid manifest from its real op
  // outputs and record it in the AssetLibrary.
  useEffect(() => {
    for (const job of jobs) {
      if (job.state !== 'done') continue;
      if (assetLibrary.get(job.id)) continue;
      const scrub = job.results.find((r) => r.op === 'scrub-mp4' && r.ok);
      const frames = job.results.find((r) => r.op === 'frame-stack' && r.ok);
      const probe = job.results.find((r) => r.op === 'probe' && r.ok);
      const probeMeta = (probe?.outputs?.probe ?? {}) as { width?: number };
      const source: ProcessedSource = {
        name: job.sourceName.replace(/\.[^.]+$/, ''),
        scrubBytes: scrub?.outputs?.scrubBytes as Uint8Array | undefined,
        frameStacks: frames?.outputs?.frameStacks as ProcessedSource['frameStacks'],
        posterBytes: job.kind === 'image' ? held.current.get(job.id)?.bytes : undefined,
        width: probeMeta.width,
      };
      try {
        const manifest = generator.generate(source);
        assetLibrary.put({
          assetId: job.id,
          name: job.sourceName,
          manifest,
          deviceProfiles: [deviceClass],
        });
        setLibraryVersion((v) => v + 1);
      } catch {
        // Nothing emittable (e.g. all ops were notes) — the job row still
        // shows its per-op results; no manifest record is created.
      }
    }
  }, [jobs, deviceClass, generator]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    void (async () => {
      for (const file of Array.from(files)) {
        const kind: 'video' | 'image' = VIDEO_EXT.test(file.name) ? 'video' : 'image';
        const bytes = new Uint8Array(await file.arrayBuffer());
        const id = `upload-${Date.now()}-${file.name}`;
        held.current.set(id, { kind, sourceName: file.name, bytes });
        assetQueue.enqueue({ id, kind, sourceName: file.name, bytes, ops: profile.ops });
      }
      setJobs(assetQueue.listJobs());
    })();
  };

  const openPreview = (jobId: string) => {
    const h = held.current.get(jobId);
    if (!h) return;
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return {
        url: URL.createObjectURL(new Blob([h.bytes.buffer as ArrayBuffer])),
        kind: h.kind,
        name: h.sourceName,
      };
    });
  };

  const library = assetLibrary.list();
  void libraryVersion;

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="section-title mb-0">Assets</h2>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-ink-700 text-ink-300">
          device class: {deviceClass}
          {settings.deviceClassOverride !== 'auto' ? ' (override)' : ''}
        </span>
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded border border-ink-700 text-ink-400"
          title={profile.rationale}
        >
          pipeline: {profile.ops.join(' → ')}
          {profile.frameStackFps.length > 0 ? ` @ ${profile.frameStackFps.join('/')}fps` : ''}
        </span>
        <label className="btn-primary text-xs cursor-pointer ml-auto">
          Upload video / image
          <input
            type="file"
            multiple
            accept="video/*,image/*"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
      </div>
      <p className="text-[11px] text-ink-400 -mt-3">{profile.rationale}</p>

      {/* Job queue */}
      <div className="card">
        <div className="section-title">Upload queue ({jobs.length})</div>
        {jobs.length === 0 && (
          <p className="text-sm text-ink-400">
            No uploads yet. Files are processed locally by the queue — per-op progress
            appears here.
          </p>
        )}
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="border border-ink-800 rounded p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-ink-100">{job.sourceName}</span>
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-ink-700 text-ink-400">
                  {job.kind}
                </span>
                <span
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${STATE_STYLE[job.state]}`}
                >
                  {job.state}
                </span>
                <span className="text-[10px] font-mono text-ink-400">
                  op {Math.min(job.opIndex + (job.state === 'done' ? 0 : 1), job.ops.length)}/
                  {job.ops.length}
                </span>
                <span className="ml-auto flex gap-2">
                  {held.current.has(job.id) && (
                    <button className="btn text-xs" onClick={() => openPreview(job.id)}>
                      Preview
                    </button>
                  )}
                  {(job.state === 'pending' || job.state === 'running') && (
                    <button
                      className="btn text-xs"
                      onClick={() => {
                        assetQueue.cancel(job.id);
                        setJobs(assetQueue.listJobs());
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  {(job.state === 'failed' || job.state === 'canceled') && (
                    <button
                      className="btn text-xs"
                      onClick={() => {
                        assetQueue.retry(job.id);
                        setJobs(assetQueue.listJobs());
                      }}
                    >
                      Retry
                    </button>
                  )}
                </span>
              </div>
              {/* Per-op progress bar */}
              <div className="flex gap-1">
                {job.ops.map((op, i) => {
                  const result = job.results[i];
                  const cls = result
                    ? result.ok
                      ? 'bg-emerald-700'
                      : 'bg-red-800'
                    : job.state === 'running' && i === job.opIndex
                      ? 'bg-accent/60 animate-pulse'
                      : 'bg-ink-700';
                  return <span key={op} className={`h-1.5 flex-1 rounded ${cls}`} title={op} />;
                })}
              </div>
              {job.state === 'failed' &&
                (job.failureReason === 'FfmpegUnavailableError' ? (
                  <div className="rounded border border-amber-900 bg-ink-950 p-3 text-xs text-amber-200 space-y-1">
                    <div className="font-semibold">
                      ffmpeg is not available in this environment
                    </div>
                    <div>{job.error}</div>
                    <div className="text-ink-300">
                      Guidance: run the hosted pipeline under Node —
                      <code className="font-mono">
                        {' '}
                        bash scripts/build-all.sh && node app/cli/dist/index.js media &lt;file&gt;
                      </code>{' '}
                      — or upload an image instead.
                    </div>
                  </div>
                ) : (
                  <div className="rounded border border-red-900 bg-ink-950 p-3 text-xs text-red-200 font-mono">
                    {job.error}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </div>

      {/* Preview player */}
      {preview && (
        <div className="card">
          <div className="flex items-center gap-2">
            <div className="section-title mb-0">Preview — {preview.name}</div>
            <button className="btn text-xs ml-auto" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          {preview.kind === 'video' ? (
            <video src={preview.url} controls className="mt-3 max-h-72 rounded border border-ink-800" />
          ) : (
            <img src={preview.url} alt={preview.name} className="mt-3 max-h-72 rounded border border-ink-800" />
          )}
        </div>
      )}

      {/* Processed library: hybrid manifests */}
      <div className="card">
        <div className="section-title">Processed assets ({library.length})</div>
        {library.length === 0 && (
          <p className="text-sm text-ink-400">
            Completed jobs emit a hybrid manifest (variants the runtime's pickVariant()
            consumes) and are recorded here.
          </p>
        )}
        <ul className="space-y-2">
          {library.map((rec) => (
            <li key={rec.assetId} className="border border-ink-800 rounded p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-100">{rec.name}</span>
                <span className="text-[10px] font-mono text-ink-400">
                  {rec.manifest.variants.length} variant
                  {rec.manifest.variants.length === 1 ? '' : 's'} ·{' '}
                  {(rec.manifest.totalBytes / 1024).toFixed(1)} KB · profiles:{' '}
                  {rec.deviceProfiles.join(', ')}
                </span>
                <button
                  className="btn-danger text-xs ml-auto"
                  onClick={() => {
                    assetLibrary.delete(rec.assetId);
                    setLibraryVersion((v) => v + 1);
                  }}
                >
                  Delete
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {rec.manifest.variants.map((v, i) => (
                  <span
                    key={i}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-ink-700 text-ink-300"
                  >
                    {v.delivery}
                    {'fps' in v ? ` ${(v as { fps?: number }).fps}fps` : ''} ·{' '}
                    {((v.bytes ?? 0) / 1024).toFixed(1)} KB
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
