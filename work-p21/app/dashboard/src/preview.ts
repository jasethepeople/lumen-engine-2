/**
 * @lumen/app-dashboard — preview-before-publish + mock share links.
 *
 * PreviewService builds the static bundle for a project IN MEMORY via
 * @lumen/app-publish's StaticExporter WITHOUT deploying anything and
 * WITHOUT touching publish history. Previews live in their own store,
 * expire after a TTL (default 1h, injectable clock), and can be shared
 * via clearly-mock links (`https://preview-<slug>.mock.lumen.app`) — there
 * are ZERO network calls; `resolveShareLink()` validates the token/expiry
 * locally and hands back the in-memory bundle.
 */

import type { EngineConfig } from '@lumen/contracts';
import {
  StaticExporter,
  type StaticBundle,
  type StaticExportOptions,
} from '@lumen/app-publish';

/** Minimal project lookup seam (satisfied by @lumen/app-projects ProjectStore). */
export interface PreviewProjectStore {
  getProject(id: string): Promise<{ id: string; name: string; config: unknown } | undefined>;
}

/** A preview record: an exported-but-never-deployed bundle with an expiry. */
export interface Preview {
  previewId: string;
  projectId: string;
  projectName: string;
  /** The static bundle (in-memory; never deployed). */
  bundle: StaticBundle;
  /** Bundle budget report (mirrored for cheap access). */
  budgets: StaticBundle['budgets'];
  createdAt: number;
  /** Epoch ms after which the preview is no longer resolvable. */
  expiresAt: number;
}

/** Public view of a preview (bundle included — it is the point of a preview). */
export interface PreviewInfo {
  previewId: string;
  projectId: string;
  projectName: string;
  bundle: StaticBundle;
  budgets: StaticBundle['budgets'];
  createdAt: number;
  expiresAt: number;
}

/** A mock share link for a preview. Clearly fake: `.mock.lumen.app` host. */
export interface ShareLink {
  /** Mock URL — no DNS record, no network, token is the real key. */
  url: string;
  token: string;
  previewId: string;
  expiresAt: number;
}

export const DEFAULT_PREVIEW_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PreviewServiceOptions {
  projects: PreviewProjectStore;
  exporter?: StaticExporter;
  exportOptions?: StaticExportOptions;
  /** Injectable clock returning epoch millis (for tests). */
  clock?: () => number;
  /** Injectable id generator (preview ids + share tokens). */
  nextId?: () => string;
  /** Preview TTL in ms (default 1h). */
  ttlMs?: number;
}

interface ShareRecord {
  token: string;
  previewId: string;
  expiresAt: number;
}

function toInfo(preview: Preview): PreviewInfo {
  return {
    previewId: preview.previewId,
    projectId: preview.projectId,
    projectName: preview.projectName,
    bundle: preview.bundle,
    budgets: preview.budgets,
    createdAt: preview.createdAt,
    expiresAt: preview.expiresAt,
  };
}

/** DNS-safe slug for the mock share URL host. */
export function previewSlug(name: string, previewId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'site'}-${previewId}`;
}

export class PreviewService {
  readonly #projects: PreviewProjectStore;
  readonly #exporter: StaticExporter;
  readonly #exportOptions: StaticExportOptions | undefined;
  readonly #clock: () => number;
  readonly #nextId: () => string;
  readonly #ttlMs: number;
  readonly #previews = new Map<string, Preview>(); // previewId → preview
  readonly #shares = new Map<string, ShareRecord>(); // token → share

  constructor(options: PreviewServiceOptions) {
    this.#projects = options.projects;
    this.#exporter = options.exporter ?? new StaticExporter();
    this.#exportOptions = options.exportOptions;
    this.#clock = options.clock ?? (() => Date.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_TTL_MS;
    let counter = 0;
    this.#nextId = options.nextId ?? (() => `pv_${(++counter).toString(36).padStart(6, '0')}_${Math.random().toString(36).slice(2, 10)}`);
  }

  /**
   * Build the static bundle for a project in memory WITHOUT deploying.
   * Nothing is written to publish history; nothing touches the network.
   */
  async createPreview(projectId: string): Promise<PreviewInfo> {
    const project = await this.#projects.getProject(projectId);
    if (!project) throw new Error(`createPreview: project not found: ${projectId}`);
    const bundle = await this.#exporter.export(
      { id: project.id, name: project.name, config: project.config as EngineConfig },
      this.#exportOptions,
    );
    const now = this.#clock();
    const preview: Preview = {
      previewId: this.#nextId(),
      projectId: project.id,
      projectName: project.name,
      bundle,
      budgets: bundle.budgets,
      createdAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.#previews.set(preview.previewId, preview);
    return toInfo(preview);
  }

  /** Fetch a live (unexpired) preview; expired previews are dropped. */
  getPreview(previewId: string): PreviewInfo | undefined {
    const preview = this.#previews.get(previewId);
    if (!preview) return undefined;
    if (this.#clock() >= preview.expiresAt) {
      this.#previews.delete(previewId);
      return undefined;
    }
    return toInfo(preview);
  }

  /**
   * Create a MOCK share link for a live preview. The URL host
   * (`*.mock.lumen.app`) is intentionally fake — sharing works only
   * locally via `resolveShareLink(token)`; zero network involved.
   */
  sharePreview(previewId: string): ShareLink {
    const preview = this.#previews.get(previewId);
    if (!preview || this.#clock() >= preview.expiresAt) {
      throw new Error(`sharePreview: no live preview ${previewId}`);
    }
    const share: ShareRecord = {
      token: this.#nextId(),
      previewId,
      expiresAt: preview.expiresAt,
    };
    this.#shares.set(share.token, share);
    return {
      url: `https://preview-${previewSlug(preview.projectName, previewId)}.mock.lumen.app`,
      token: share.token,
      previewId,
      expiresAt: share.expiresAt,
    };
  }

  /**
   * Resolve a share token to its preview bundle. Throws on unknown token
   * or expired link/preview.
   */
  resolveShareLink(token: string): PreviewInfo {
    const share = this.#shares.get(token);
    if (!share) throw new Error('resolveShareLink: invalid share token');
    if (this.#clock() >= share.expiresAt) {
      throw new Error('resolveShareLink: share link expired');
    }
    const preview = this.getPreview(share.previewId);
    if (!preview) throw new Error('resolveShareLink: share link expired');
    return preview;
  }
}
