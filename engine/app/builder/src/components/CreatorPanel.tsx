/**
 * CreatorPanel — marketplace creator sub-panel over the real
 * @lumen/app-marketplace CreatorTemplateService: upload own templates
 * (metadata form + entryConfig JSON paste with surfaced validation issues),
 * edit own metadata, generated preview cards, and creator earnings/payouts
 * via @lumen/app-billing's RevenueShareLedger.
 */

import { useCallback, useEffect, useState } from 'react';
import type { EngineConfig, TemplateKind } from '@lumen/contracts';
import { parseConfig } from '@lumen/config';
import {
  CATEGORIES,
  CreatorTemplateValidationError,
  makeThumbnail,
  type Category,
  type CreatorTemplateRecord,
  type PreviewDescriptor,
} from '@lumen/app-marketplace';
import type { Payout } from '@lumen/app-billing';
import {
  USER_ID,
  creatorService,
  creatorTemplateStore,
  revenueLedger,
} from '../platform/services';

const TEMPLATE_KINDS: TemplateKind[] = [
  'scroll-video',
  'cinematic-spa',
  'viewer-3d',
  'storytelling',
];

const PLACEHOLDER_CONFIG = JSON.stringify(
  {
    meta: { title: 'My template' },
    template: 'scroll-video',
    scenes: [],
  },
  null,
  2,
);

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface CreatorPanelProps {
  onChanged(): void;
  onNotice(msg: string | null): void;
  onError(msg: string | null): void;
}

export function CreatorPanel({ onChanged, onNotice, onError }: CreatorPanelProps) {
  const [mine, setMine] = useState<CreatorTemplateRecord[]>([]);
  const [previews, setPreviews] = useState<Record<string, PreviewDescriptor>>({});
  const [editing, setEditing] = useState<string | null>(null);

  // Upload form state
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [kind, setKind] = useState<TemplateKind>('scroll-video');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState('');
  const [tier, setTier] = useState<'free' | 'pro'>('free');
  const [configText, setConfigText] = useState(PLACEHOLDER_CONFIG);
  const [issues, setIssues] = useState<string[]>([]);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVersion, setEditVersion] = useState('');
  const [editTier, setEditTier] = useState<'free' | 'pro'>('free');

  // Earnings
  const [earnings, setEarnings] = useState(0);
  const [payout, setPayout] = useState<Payout | null>(null);

  const refresh = useCallback(() => {
    const records = creatorTemplateStore.list().filter((r) => r.authorId === USER_ID);
    setMine(records);
    const map: Record<string, PreviewDescriptor> = {};
    for (const rec of records) {
      try {
        map[rec.meta.id] = creatorService.generatePreview(rec.meta.id);
      } catch {
        /* preview generation is best-effort for the card */
      }
    }
    setPreviews(map);
    setEarnings(revenueLedger.creatorEarnings(USER_ID));
  }, []);

  useEffect(refresh, [refresh]);

  const toggleCategory = (c: Category) =>
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const upload = () => {
    onError(null);
    onNotice(null);
    setIssues([]);
    const parsed = parseConfig(configText);
    if (!parsed.ok) {
      setIssues(parsed.errors.map((e) => `${e.path}: ${e.message}`));
      return;
    }
    try {
      creatorService.uploadTemplate(
        USER_ID,
        {
          id: id.trim(),
          name: name.trim(),
          description: description.trim(),
          templateKind: kind,
          version: version.trim(),
          categories,
          tags: tags
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
          tier,
          engineMinVersion: '0.1.0',
          thumbnail: makeThumbnail(name.trim() || id.trim()),
        },
        parsed.config as EngineConfig,
      );
      onNotice(`Uploaded "${name}" — it now appears in the Browse tab.`);
      setId('');
      setName('');
      setDescription('');
      setTags('');
      refresh();
      onChanged();
    } catch (err) {
      if (err instanceof CreatorTemplateValidationError) {
        setIssues(err.issues);
      } else {
        onError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const startEdit = (rec: CreatorTemplateRecord) => {
    setEditing(rec.meta.id);
    setEditName(rec.meta.name);
    setEditDescription(rec.meta.description);
    setEditVersion(rec.meta.version);
    setEditTier(rec.meta.tier);
  };

  const saveEdit = () => {
    if (!editing) return;
    onError(null);
    try {
      creatorService.updateMeta(editing, USER_ID, {
        name: editName.trim(),
        description: editDescription.trim(),
        version: editVersion.trim(),
        tier: editTier,
      });
      onNotice(`Updated metadata for ${editing}.`);
      setEditing(null);
      refresh();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const requestPayout = () => {
    onError(null);
    try {
      const p = revenueLedger.requestPayout(USER_ID);
      setPayout(p);
      onNotice(
        `Payout ${p.payoutId} scheduled for ${formatCents(p.amountCents)} (requested ${new Date(
          p.requestedAt,
        ).toLocaleString()}).`,
      );
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* Earnings */}
      <section className="card flex items-center gap-4 flex-wrap">
        <div>
          <div className="field-label mb-0">Creator earnings (outstanding)</div>
          <div className="text-xl text-ink-100 font-semibold">{formatCents(earnings)}</div>
          <div className="text-[10px] font-mono text-ink-500">
            70% creator share of your template sales
          </div>
        </div>
        <button
          className="btn-primary text-xs disabled:opacity-40"
          disabled={earnings <= 0}
          onClick={requestPayout}
        >
          Request payout
        </button>
        {payout && (
          <span className="text-[10px] font-mono text-emerald-300">
            payout {payout.payoutId} · {payout.status} · {formatCents(payout.amountCents)}
          </span>
        )}
      </section>

      {/* My templates */}
      <section className="card space-y-3">
        <h3 className="text-sm text-ink-100 font-semibold">My templates</h3>
        {mine.length === 0 && (
          <p className="text-xs text-ink-500">You have not uploaded any templates yet.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {mine.map((rec) => {
            const preview = previews[rec.meta.id];
            return (
              <div key={rec.meta.id} className="rounded border border-ink-800 p-3 space-y-2">
                {preview && (
                  <img
                    src={preview.thumbnail}
                    alt={rec.meta.name}
                    className="w-full h-24 object-cover rounded border border-ink-800"
                  />
                )}
                <div className="text-sm text-ink-100">{rec.meta.name}</div>
                <div className="text-[10px] font-mono text-ink-400">
                  {rec.meta.id} · v{rec.meta.version} · {rec.meta.tier}
                  {preview &&
                    ` · ${preview.sceneCount} scenes · ~${Math.round(preview.estimatedDuration)}s`}
                </div>
                <button className="btn text-xs" onClick={() => startEdit(rec)}>
                  Edit metadata
                </button>
              </div>
            );
          })}
        </div>
        {editing && (
          <div className="rounded border border-ink-700 p-3 space-y-2">
            <span className="field-label">Editing {editing}</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
              <input
                value={editVersion}
                onChange={(e) => setEditVersion(e.target.value)}
                placeholder="Version (semver)"
              />
              <select value={editTier} onChange={(e) => setEditTier(e.target.value as 'free' | 'pro')}>
                <option value="free">free</option>
                <option value="pro">pro</option>
              </select>
              <input
                className="sm:col-span-2"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description"
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-xs" onClick={saveEdit}>
                Save
              </button>
              <button className="btn text-xs" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Upload */}
      <section className="card space-y-3">
        <h3 className="text-sm text-ink-100 font-semibold">Upload a template</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id (kebab-case)" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
          <input
            className="sm:col-span-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
          />
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" />
          <select value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
            {TEMPLATE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value as 'free' | 'pro')}>
            <option value="free">free tier</option>
            <option value="pro">pro tier</option>
          </select>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tags, comma, separated"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                categories.includes(c)
                  ? 'border-accent/60 text-accent'
                  : 'border-ink-700 text-ink-400 hover:text-ink-200'
              }`}
              onClick={() => toggleCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div>
          <span className="field-label">entryConfig (EngineConfig JSON)</span>
          <textarea
            className="w-full h-40 font-mono text-xs"
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            spellCheck={false}
          />
        </div>
        {issues.length > 0 && (
          <ul className="rounded border border-red-900 bg-ink-950 p-3 space-y-1">
            {issues.map((issue, i) => (
              <li key={i} className="text-xs text-red-200 font-mono">
                {issue}
              </li>
            ))}
          </ul>
        )}
        <button className="btn-primary text-xs" onClick={upload}>
          Upload template
        </button>
      </section>
    </div>
  );
}
