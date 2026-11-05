import { deleteRecord, putRecord, readKeys, readOne, type IdbSpec } from '@/io/storage/idb';

/** IndexedDB store for imported model files, keyed by object id. */

const STORE_NAME = 'blobs';

/** Opened by `io/idb.ts`, which keeps the connection and creates `blobs` on first use. */
const SPEC: IdbSpec = {
  name: 'oc-objects',
  version: 1,
  upgrade: db => {
    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  },
};

/** Saves a model file under the given id, replacing any previous content. */
export function putModelBlob(id: string, file: Blob): Promise<void> {
  return putRecord(SPEC, STORE_NAME, file, id);
}

/** Loads a stored model file; null when absent. */
export function getModelBlob(id: string): Promise<Blob | null> {
  return readOne<Blob>(SPEC, STORE_NAME, id);
}

/** Deletes a stored model file. */
export function deleteModelBlob(id: string): Promise<void> {
  return deleteRecord(SPEC, STORE_NAME, id);
}

/** Every key currently held in the blob store. */
export async function listModelBlobKeys(): Promise<string[]> {
  const keys = await readKeys(SPEC, STORE_NAME);
  return keys.filter((key): key is string => typeof key === 'string');
}
