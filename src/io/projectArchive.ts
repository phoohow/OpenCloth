import type { Project } from '../core/model/types';
import { projectCodec } from './codec';
import { deleteModelBlob, listModelBlobKeys } from './objectStore';

/** IndexedDB archive of project snapshots: the recent-project list and the autosave slot. */

const DB_NAME = 'oc-projects';
const RECENT_STORE = 'recent';
const AUTOSAVE_STORE = 'autosave';
const AUTOSAVE_KEY = 'autosave';

/** Entries kept in the recent-project list. */
export const RECENT_LIMIT = 8;

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

/** Autosave slot contents. */
export interface AutosaveRecord {
  savedAt: string;
  json: string;
}

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
  const record: RecentRecord = {
    id: project.meta.name,
    name: project.meta.name,
    savedAt: new Date().toISOString(),
    json: projectCodec.encode(project),
  };
  try {
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

/** Overwrites the single autosave slot with the current project. */
export async function saveAutosave(project: Project): Promise<void> {
  if (!storageAvailable()) return;
  const record: AutosaveRecord = { savedAt: new Date().toISOString(), json: projectCodec.encode(project) };
  try {
    await withStores([AUTOSAVE_STORE], 'readwrite', tx => { tx.objectStore(AUTOSAVE_STORE).put(record, AUTOSAVE_KEY); });
  } catch {
    // Report autosave failures through the status line.
  }
}

/** Current autosave slot; null when autosave has never run. */
export async function readAutosave(): Promise<AutosaveRecord | null> {
  if (!storageAvailable()) return null;
  try {
    const record = await withStores([AUTOSAVE_STORE], 'readonly', tx =>
      requestResult<AutosaveRecord | undefined>(tx.objectStore(AUTOSAVE_STORE).get(AUTOSAVE_KEY) as IDBRequest));
    return record ?? null;
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
    const autosave = await readAutosave();
    if (autosave) {
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
