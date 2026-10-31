import type { Project } from '../core/model/types';
import { projectCodec } from './codec';
import { deleteModelBlob, listModelBlobKeys } from './objectStore';
import { embedProjectAssets } from './projectPackage';

/** IndexedDB archive of project snapshots: the recent-project list and the autosave snapshots. */

const DB_NAME = 'oc-projects';
const RECENT_STORE = 'recent';
const AUTOSAVE_STORE = 'autosave';

/** Entries kept in the recent-project list. */
export const RECENT_LIMIT = 8;

/** Autosave snapshots kept before the oldest is dropped. */
export const AUTOSAVE_LIMIT = 5;

/** Menu entry for one stored project snapshot. */
export interface RecentSummary {
  id: string;
  name: string;
  savedAt: string;
}

/** Stored list entry with its serialized project. */
interface RecentRecord extends RecentSummary {
  json: string;
}

/** Autosave snapshot contents. */
export interface AutosaveRecord {
  id: string;
  savedAt: string;
  json: string;
}

/** One autosave snapshot without its payload. */
export type AutosaveSummary = Omit<AutosaveRecord, 'json'>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECENT_STORE)) db.createObjectStore(RECENT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) db.createObjectStore(AUTOSAVE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStores<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let settled = false;
    const result = run(transaction);
    transaction.oncomplete = () => { settled = true; resolve(result); db.close(); };
    transaction.onerror = () => { if (!settled) reject(transaction.error); };
    transaction.onabort = () => { if (!settled) reject(transaction.error); };
  });
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Newest first. */
export function sortRecents(records: RecentRecord[]): RecentRecord[] {
  return [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** List to persist: the new record replaces any entry with the same id and the tail beyond the limit drops. */
export function pruneRecents(records: RecentRecord[], record: RecentRecord, limit = RECENT_LIMIT): RecentRecord[] {
  const others = records.filter(r => r.id !== record.id);
  return [record, ...sortRecents(others)].slice(0, Math.max(1, limit));
}

/** Stores the project under its name, dropping entries beyond the limit. */
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
    const stale = await withStores([RECENT_STORE], 'readonly', tx =>
      requestResult<RecentRecord[]>(tx.objectStore(RECENT_STORE).getAll() as IDBRequest));
    const next = pruneRecents(stale, record);
    await withStores([RECENT_STORE], 'readwrite', tx => {
      const store = tx.objectStore(RECENT_STORE);
      store.clear();
      for (const entry of next) store.put(entry);
    });
  } catch {
    // Ignore recent-list failures; saving the project itself succeeded.
  }
}

/** Recent projects, newest first. */
export async function listRecent(): Promise<RecentSummary[]> {
  if (!storageAvailable()) return [];
  try {
    const records = await withStores([RECENT_STORE], 'readonly', tx =>
      requestResult<RecentRecord[]>(tx.objectStore(RECENT_STORE).getAll() as IDBRequest));
    return sortRecents(records).map(({ id, name, savedAt }) => ({ id, name, savedAt }));
  } catch {
    return [];
  }
}

/** Serialized project of one recent entry; null when it is gone. */
export async function readRecent(id: string): Promise<string | null> {
  if (!storageAvailable()) return null;
  try {
    const record = await withStores([RECENT_STORE], 'readonly', tx =>
      requestResult<RecentRecord | undefined>(tx.objectStore(RECENT_STORE).get(id) as IDBRequest));
    return record?.json ?? null;
  } catch {
    return null;
  }
}

/** Empties the recent-project list. */
export async function clearRecent(): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await withStores([RECENT_STORE], 'readwrite', tx => { tx.objectStore(RECENT_STORE).clear(); });
  } catch {
    // Ignore clear failures when the store cannot be opened.
  }
}

/** Autosave snapshots, newest first. */
export function sortAutosaves(records: AutosaveRecord[]): AutosaveRecord[] {
  return [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Snapshots to keep after a write: newest first, oldest beyond the limit dropped. */
export function pruneAutosaves(records: AutosaveRecord[], limit = AUTOSAVE_LIMIT): AutosaveRecord[] {
  return sortAutosaves(records).slice(0, Math.max(1, limit));
}

/** Stores one autosave snapshot and drops the oldest ones beyond the limit. */
export async function saveAutosave(project: Project): Promise<AutosaveRecord | null> {
  if (!storageAvailable()) return null;
  try {
    const embedded = await embedProjectAssets(project);
    const savedAt = new Date().toISOString();
    const record: AutosaveRecord = { id: savedAt, savedAt, json: projectCodec.encode(embedded) };
    await withStores([AUTOSAVE_STORE], 'readwrite', tx => tx.objectStore(AUTOSAVE_STORE).put(record, record.id));
    const stored = await withStores([AUTOSAVE_STORE], 'readonly', tx =>
      requestResult<AutosaveRecord[]>(tx.objectStore(AUTOSAVE_STORE).getAll() as IDBRequest));
    const keep = pruneAutosaves(stored);
    const keepIds = new Set(keep.map(r => r.id));
    await withStores([AUTOSAVE_STORE], 'readwrite', tx => {
      const store = tx.objectStore(AUTOSAVE_STORE);
      for (const entry of stored) if (!keepIds.has(entry.id)) store.delete(entry.id);
    });
    return record;
  } catch {
    return null;
  }
}

/** Autosave snapshots, newest first. */
export async function listAutosaves(): Promise<AutosaveSummary[]> {
  if (!storageAvailable()) return [];
  try {
    const records = await withStores([AUTOSAVE_STORE], 'readonly', tx =>
      requestResult<AutosaveRecord[]>(tx.objectStore(AUTOSAVE_STORE).getAll() as IDBRequest));
    return sortAutosaves(records).map(({ id, savedAt }) => ({ id, savedAt }));
  } catch {
    return [];
  }
}

/** One autosave snapshot by id, or the newest one when no id is given. */
export async function readAutosave(id?: string): Promise<AutosaveRecord | null> {
  if (!storageAvailable()) return null;
  try {
    if (id !== undefined) {
      const record = await withStores([AUTOSAVE_STORE], 'readonly', tx =>
        requestResult<AutosaveRecord | undefined>(tx.objectStore(AUTOSAVE_STORE).get(id) as IDBRequest));
      return record ?? null;
    }
    const records = await withStores([AUTOSAVE_STORE], 'readonly', tx =>
      requestResult<AutosaveRecord[]>(tx.objectStore(AUTOSAVE_STORE).getAll() as IDBRequest));
    return sortAutosaves(records)[0] ?? null;
  } catch {
    return null;
  }
}

/** Blob keys one project (live or parsed from a snapshot) still references. */
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

/**
 * Deletes model blobs no retained snapshot references. Called when a project is
 * opened: the undo history resets, so removed imports can no longer come back.
 */
export async function pruneOrphanBlobs(current: Project): Promise<void> {
  if (!storageAvailable()) return;
  try {
    const live = new Set(collectBlobKeys(current));
    const records = await withStores([RECENT_STORE], 'readonly', tx =>
      requestResult<RecentRecord[]>(tx.objectStore(RECENT_STORE).getAll() as IDBRequest));
    for (const record of records) {
      try {
        for (const key of collectBlobKeys(JSON.parse(record.json))) live.add(key);
      } catch { /* A corrupt entry keeps nothing alive. */ }
    }
    const autosaves = await withStores([AUTOSAVE_STORE], 'readonly', tx =>
      requestResult<AutosaveRecord[]>(tx.objectStore(AUTOSAVE_STORE).getAll() as IDBRequest));
    for (const autosave of autosaves) {
      try {
        for (const key of collectBlobKeys(JSON.parse(autosave.json))) live.add(key);
      } catch { /* ignore */ }
    }
    for (const key of await listModelBlobKeys()) {
      if (!live.has(key)) await deleteModelBlob(key).catch(() => { });
    }
  } catch {
    // Blobs stay when either store cannot be opened.
  }
}
