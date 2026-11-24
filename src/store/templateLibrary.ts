import type { GarmentTemplate } from '@/pattern';

import { FILE_TEMPLATES } from '@/app/assembly';
import { genId } from '@/base/id';
import { parsePatternFile, patternFileToTemplate } from '@/io/codec';
import {
  deletePatternTemplateAsset, listPatternTemplateAssets, savePatternTemplateAsset,
  type PatternTemplateAsset,
} from '@/io/storage';

let snapshot: readonly GarmentTemplate[] = [...FILE_TEMPLATES];

const listeners = new Set<() => void>();

let pending: Promise<void> | null = null;

export interface TemplateImportResult {
  added: string[];
  errors: string[];
  warnings: string[];
}

export function getTemplates(): readonly GarmentTemplate[] {
  return snapshot;
}

export function subscribeTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function reload(): Promise<void> {
  let assets: PatternTemplateAsset[] = [];
  try {
    assets = await listPatternTemplateAssets();
  } catch {
  }

  const byKey = new Map<string, GarmentTemplate>();
  for (const template of [...FILE_TEMPLATES, ...userTemplates(assets)]) {
    if (!byKey.has(template.key)) byKey.set(template.key, template);
  }

  snapshot = [...byKey.values()];
  for (const listener of listeners) listener();
}

export function hydrateTemplates(): Promise<void> {
  pending ??= reload().finally(() => { pending = null; });
  return pending;
}

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
        result.errors.push(`${entry.name}：key「${key}」与默认文件夹里的版型重复`);
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

export async function importPatternFiles(files: File[]): Promise<TemplateImportResult> {
  const entries = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
  return importPatternTexts(entries);
}

export async function removeUserTemplate(assetId: string): Promise<void> {
  await deletePatternTemplateAsset(assetId);
  await reload();
}
