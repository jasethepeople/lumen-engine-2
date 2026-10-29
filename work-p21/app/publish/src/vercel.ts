/**
 * @lumen/app-publish — VercelClient interface + MockVercelClient.
 *
 * The mock implements the full deployment lifecycle (create / get / list)
 * against a pluggable store (Memory + LocalStorage adapters) with injectable
 * simulated latency (default 0 for tests). It NEVER performs network I/O:
 * no fetch, no http/https — all state lives in the injected store.
 */

/** One uploaded file in a deployment. */
export interface VercelFile {
  path: string;
  content: string | Uint8Array;
}

/** A recorded mock deployment. */
export interface VercelDeployment {
  deploymentId: string;
  projectName: string;
  url: string;
  state: 'READY';
  createdAt: number;
  files: VercelFile[];
}

export interface CreateDeploymentInput {
  name: string;
  files: readonly VercelFile[];
}

/** Client surface used by PublishService (mock-first; a real adapter later). */
export interface VercelClient {
  createDeployment(input: CreateDeploymentInput): Promise<VercelDeployment>;
  getDeployment(deploymentId: string): Promise<VercelDeployment | undefined>;
  listDeployments(projectName: string): Promise<VercelDeployment[]>;
}

/** Persistence for mock deployments (sync; the client adds latency). */
export interface VercelDeploymentStore {
  load(): VercelDeployment[];
  save(deployments: VercelDeployment[]): void;
}

/** In-memory store (default). */
export class MemoryVercelStore implements VercelDeploymentStore {
  #deployments: VercelDeployment[] = [];

  load(): VercelDeployment[] {
    return this.#deployments.map((d) => ({ ...d, files: d.files.map((f) => ({ ...f })) }));
  }

  save(deployments: VercelDeployment[]): void {
    this.#deployments = deployments.map((d) => ({ ...d, files: d.files.map((f) => ({ ...f })) }));
  }
}

export const LOCALSTORAGE_VERCEL_KEY = 'lumen.publish.vercel-deployments.v1';

/** LocalStorage-backed store (browser); throws under Node when used. */
export class LocalStorageVercelStore implements VercelDeploymentStore {
  #key: string;

  constructor(key: string = LOCALSTORAGE_VERCEL_KEY) {
    this.#key = key;
  }

  #storage(): Storage {
    if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
      throw new Error('LocalStorageVercelStore: localStorage unavailable (non-browser)');
    }
    return globalThis.localStorage;
  }

  load(): VercelDeployment[] {
    const raw = this.#storage().getItem(this.#key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Uint8Array contents do not survive JSON round-trips; encode as latin1
    // strings is avoided — file contents are stored as-is when strings.
    return parsed as VercelDeployment[];
  }

  save(deployments: VercelDeployment[]): void {
    this.#storage().setItem(this.#key, JSON.stringify(deployments));
  }
}

/** Slugify a project name into a mock URL host label. */
export function deploymentSlug(name: string, deploymentId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'site';
  const suffix = deploymentId.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8) || '00000000';
  return `${base}-${suffix}`;
}

export interface MockVercelClientOptions {
  store?: VercelDeploymentStore;
  /** Simulated latency in ms per call (default 0). */
  latencyMs?: number;
  /** Injectable clock (default Date.now). */
  clock?: () => number;
  /** Injectable id generator (default: sequential mock ids). */
  nextId?: () => string;
}

export class MockVercelClient implements VercelClient {
  readonly #store: VercelDeploymentStore;
  readonly #latencyMs: number;
  readonly #clock: () => number;
  readonly #nextId: () => string;

  constructor(options: MockVercelClientOptions = {}) {
    this.#store = options.store ?? new MemoryVercelStore();
    this.#latencyMs = Math.max(0, options.latencyMs ?? 0);
    this.#clock = options.clock ?? (() => Date.now());
    let counter = 0;
    this.#nextId = options.nextId ?? (() => `dpl_mock_${(++counter).toString(36).padStart(6, '0')}`);
  }

  async #delay(): Promise<void> {
    if (this.#latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#latencyMs));
    }
  }

  async createDeployment(input: CreateDeploymentInput): Promise<VercelDeployment> {
    await this.#delay();
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new Error('MockVercelClient: deployment name must be a non-empty string');
    }
    const deploymentId = this.#nextId();
    const deployment: VercelDeployment = {
      deploymentId,
      projectName: input.name,
      url: `https://${deploymentSlug(input.name, deploymentId)}.mock.vercel.app`,
      state: 'READY',
      createdAt: this.#clock(),
      files: input.files.map((f) => ({ ...f })),
    };
    const all = this.#store.load();
    all.push(deployment);
    this.#store.save(all);
    return { ...deployment, files: deployment.files.map((f) => ({ ...f })) };
  }

  async getDeployment(deploymentId: string): Promise<VercelDeployment | undefined> {
    await this.#delay();
    const found = this.#store.load().find((d) => d.deploymentId === deploymentId);
    return found ? { ...found, files: found.files.map((f) => ({ ...f })) } : undefined;
  }

  async listDeployments(projectName: string): Promise<VercelDeployment[]> {
    await this.#delay();
    return this.#store
      .load()
      .filter((d) => d.projectName === projectName)
      .map((d) => ({ ...d, files: d.files.map((f) => ({ ...f })) }));
  }
}
