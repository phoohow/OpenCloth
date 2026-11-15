import { genId } from '@/base/id';
import {
  GARMENT_TEMPLATES, parsePatternFile, patternFileToTemplate, type GarmentTemplate,
} from '@/pattern/template';
import {
  deletePatternTemplateAsset, listPatternTemplateAssets, savePatternTemplateAsset,
  type PatternTemplateAsset,
} from '@/io/storage';

/** Keys already supplied by the shipped files; the same files are not parsed twice. */
const BUILTIN_KEYS = new Set(GARMENT_TEMPLATES.map(template => template.key));

/** Every `.ocpat` in the default folder; Vite turns this into one bundle-time lookup. */
const BUNDLED_FILES: Record<string, unknown> = import.meta.glob(
  '/assets/patterns/*.ocpat',
  { query: '?raw', import: 'default', eager: true },
);

/** Catalogue entries visible to the pattern tab, rebuilt whenever a source changes. */
let snapshot: readonly GarmentTemplate[] = [...GARMENT_TEMPLATES];
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;

/** Current catalogue, stable until the next change so it can back `useSyncExternalStore`. */
export function getTemplates(): readonly GarmentTemplate[] {
  return snapshot;
}

/** Subscribes to catalogue changes; returns the unsubscribe function. */
export function subscribeTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Outcome of importing one or more template files. */
export interface TemplateImportResult {
  added: string[];
  errors: string[];
  warnings: string[];
}

/** Reads bundled files and saved imports, then publishes one deduplicated catalogue. */
async function reload(): Promise<void> {
  const bundled = readBundledTemplates(BUILTIN_KEYS);
  let assets: PatternTemplateAsset[] = [];
  try {
    assets = await listPatternTemplateAssets();
  } catch {
    // Local storage is optional; built-in and bundled templates still work without it.
  }
  const byKey = new Map<string, GarmentTemplate>();
  for (const template of [...GARMENT_TEMPLATES, ...bundled, ...userTemplates(assets)]) {
    if (!byKey.has(template.key)) byKey.set(template.key, template);
  }
  snapshot = [...byKey.values()];
  for (const listener of listeners) listener();
}

/** Loads the catalogue once at startup; concurrent callers share the same read. */
export function hydrateTemplates(): Promise<void> {
  pending ??= reload().finally(() => { pending = null; });
  return pending;
}

/** Parses files in the default folder, skipping invalid ones and keys already in `skipKeys`. */
export function readBundledTemplates(skipKeys: ReadonlySet<string> = new Set()): GarmentTemplate[] {
  const out: GarmentTemplate[] = [];
  for (const path of Object.keys(BUNDLED_FILES).sort()) {
    try {
      const raw = BUNDLED_FILES[path]!;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (skipKeys.has(fileKey(text) ?? '')) continue;
      const { file } = parsePatternFile(text);
      out.push(patternFileToTemplate(file, 'file'));
    } catch (error) {
      console.error(`Bundled template ${path} failed to load:`, error);
    }
  }
  return out;
}

/** Reads only a file's key, so already-loaded presets are not validated a second time. */
function fileKey(text: string): string | null {
  try {
    const doc = JSON.parse(text) as { key?: unknown };
    return typeof doc.key === 'string' ? doc.key : null;
  } catch {
    return null;
  }
}

/** Parses saved imports, keeping the asset id so a row can be removed later. */
function userTemplates(assets: PatternTemplateAsset[]): GarmentTemplate[] {
  const out: GarmentTemplate[] = [];
  for (const asset of assets) {
    try {
      const { file } = parsePatternFile(asset.json);
      out.push(patternFileToTemplate(file, 'user', asset.id));
    } catch (error) {
      console.error(`Saved template ${asset.name} failed to load:`, error);
    }
  }
  return out;
}

/** Parses template documents and persists the valid ones as user assets. */
export async function importPatternTexts(
  entries: { name: string; text: string }[],
): Promise<TemplateImportResult> {
  const result: TemplateImportResult = { added: [], errors: [], warnings: [] };
  await hydrateTemplates();

  const reserved = new Set(
    snapshot.filter(template => template.source !== 'user').map(template => template.key),
  );
  const existing = new Map(
    snapshot
      .filter(template => template.source === 'user' && template.assetId)
      .map(template => [template.key, template.assetId!]),
  );
  const savedAt = new Date().toISOString();

  for (const entry of entries) {
    try {
      const parsed = parsePatternFile(entry.text);
      const { key, name } = parsed.file;
      if (reserved.has(key)) {
        result.errors.push(`${entry.name}：key「${key}」与内置或文件夹版型重复`);
        continue;
      }
      const assetId = existing.get(key) ?? genId('asset');
      await savePatternTemplateAsset({ id: assetId, key, name, json: entry.text, createdAt: savedAt });
      existing.set(key, assetId);
      result.added.push(name);
      for (const warning of parsed.warnings) result.warnings.push(`${name}：${warning}`);
    } catch (error) {
      result.errors.push(`${entry.name}：${(error as Error).message}`);
    }
  }

  await reload();
  return result;
}

/** Reads picked template files and adds each valid one to the library. */
export async function importPatternFiles(files: File[]): Promise<TemplateImportResult> {
  const entries = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
  return importPatternTexts(entries);
}

/** Removes one imported template from local storage and the catalogue. */
export async function removeUserTemplate(assetId: string): Promise<void> {
  await deletePatternTemplateAsset(assetId);
  await reload();
}
