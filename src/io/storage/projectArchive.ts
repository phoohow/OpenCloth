import type { Project } from '@/model/types';

import { projectCodec } from '@/io/serialization/codec';
import { putRecord, readAll, readOne, storageAvailable, writeStore, type IdbSpec } from '@/io/storage/idb';
import { deleteModelBlob, listModelBlobKeys } from '@/io/storage/objectStore';
import { embedProjectAssets } from '@/io/storage/projectPackage';

const RECENT_STORE = 'recent';

const AUTOSAVE_STORE = 'autosave';

const SPEC: IdbSpec = {
  name: 'oc-projects',
  upgrade: db => {
    db.createObjectStore(RECENT_STORE, { keyPath: 'id' });
    db.createObjectStore(AUTOSAVE_STORE);
  },
};

export const RECENT_LIMIT = 8;

export const AUTOSAVE_LIMIT = 5;

export interface RecentSummary {
  id: string;
  name: string;
  savedAt: string;
}

interface RecentRecord extends RecentSummary {
  json: string;
}

export interface AutosaveRecord {
  id: string;
  savedAt: string;
  json: string;
}

export type AutosaveSummary = Omit<AutosaveRecord, 'json'>;

export function sortRecents(records: RecentRecord[]): RecentRecord[] {
  return [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function pruneRecents(records: RecentRecord[], record: RecentRecord, limit = RECENT_LIMIT): RecentRecord[] {
  const others = records.filter(r => r.id !== record.id);
  return [record, ...sortRecents(others)].slice(0, Math.max(1, limit));
}

export async function pushRecent(project: Project): Promise<void> {
  if (!storageAvailable()) return;
  try {
    const embedded = await embedProjectAssets(project);
    const record: RecentRecord = {
      id: project.meta.name,
      name: project.meta.name,
      savedAt: new Date().toISOString(),
      json: projectCodec.encode(embedded),
    };
    const next = pruneRecents(await readAll<RecentRecord>(SPEC, RECENT_STORE), record);
    await writeStore(SPEC, RECENT_STORE, store => {
      store.clear();
      for (const entry of next) store.put(entry);
    });
  } catch {
  }
}

export async function listRecent(): Promise<RecentSummary[]> {
  if (!storageAvailable()) return [];
  try {
    const records = await readAll<RecentRecord>(SPEC, RECENT_STORE);
    return sortRecents(records).map(({ id, name, savedAt }) => ({ id, name, savedAt }));
  } catch {
    return [];
  }
}

export async function readRecent(id: string): Promise<string | null> {
  if (!storageAvailable()) return null;
  try {
    const record = await readOne<RecentRecord>(SPEC, RECENT_STORE, id);
    return record?.json ?? null;
  } catch {
    return null;
  }
}

export async function clearRecent(): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await writeStore(SPEC, RECENT_STORE, store => store.clear());
  } catch {
  }
}

export function sortAutosaves(records: AutosaveRecord[]): AutosaveRecord[] {
  return [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function pruneAutosaves(records: AutosaveRecord[], limit = AUTOSAVE_LIMIT): AutosaveRecord[] {
  return sortAutosaves(records).slice(0, Math.max(1, limit));
}

export async function saveAutosave(project: Project): Promise<AutosaveRecord | null> {
  if (!storageAvailable()) return null;
  try {
    const embedded = await embedProjectAssets(project);
    const savedAt = new Date().toISOString();
    const record: AutosaveRecord = { id: savedAt, savedAt, json: projectCodec.encode(embedded) };
    await putRecord(SPEC, AUTOSAVE_STORE, record, record.id);
    const stored = await readAll<AutosaveRecord>(SPEC, AUTOSAVE_STORE);
    const keepIds = new Set(pruneAutosaves(stored).map(r => r.id));
    await writeStore(SPEC, AUTOSAVE_STORE, store => {
      for (const entry of stored) if (!keepIds.has(entry.id)) store.delete(entry.id);
    });
    return record;
  } catch {
    return null;
  }
}

export async function listAutosaves(): Promise<AutosaveSummary[]> {
  if (!storageAvailable()) return [];
  try {
    const records = await readAll<AutosaveRecord>(SPEC, AUTOSAVE_STORE);
    return sortAutosaves(records).map(({ id, savedAt }) => ({ id, savedAt }));
  } catch {
    return [];
  }
}

export async function readAutosave(id?: string): Promise<AutosaveRecord | null> {
  if (!storageAvailable()) return null;
  try {
    if (id !== undefined) return readOne<AutosaveRecord>(SPEC, AUTOSAVE_STORE, id);
    return sortAutosaves(await readAll<AutosaveRecord>(SPEC, AUTOSAVE_STORE))[0] ?? null;
  } catch {
    return null;
  }
}

export function collectBlobKeys(value: unknown): string[] {
  const project = value as Partial<Project> | null;
  const keys: string[] = [];
  if (!project || typeof project !== 'object') return keys;
  if (project.avatar?.glbObjectKey) keys.push(project.avatar.glbObjectKey);
  const lights = project.scene?.lights;
  if (lights?.iblObjectKey) keys.push(lights.iblObjectKey);
  for (const ref of project.scene?.referenceObjects ?? []) {
    if (ref.objectKey) keys.push(ref.objectKey);
  }

  return keys;
}

export async function pruneOrphanBlobs(current: Project): Promise<void> {
  if (!storageAvailable()) return;
  try {
    const live = new Set(collectBlobKeys(current));
    const records = await readAll<RecentRecord>(SPEC, RECENT_STORE);
    for (const record of records) {
      try {
        for (const key of collectBlobKeys(JSON.parse(record.json))) live.add(key);
      } catch {}
    }

    const autosaves = await readAll<AutosaveRecord>(SPEC, AUTOSAVE_STORE);
    for (const autosave of autosaves) {
      try {
        for (const key of collectBlobKeys(JSON.parse(autosave.json))) live.add(key);
      } catch {}
    }

    for (const key of await listModelBlobKeys()) {
      if (!live.has(key)) await deleteModelBlob(key).catch(() => {});
    }
  } catch {
  }
}
