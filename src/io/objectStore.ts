import { requestResult, withStores, type IdbSpec } from './idb';

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

/** Runs one request against the blob store and resolves with its result. */
function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return withStores(SPEC, [STORE_NAME], mode, tx => requestResult(run(tx.objectStore(STORE_NAME))));
}

/** Saves a model file under the given id, replacing any previous content. */
export async function putModelBlob(id: string, file: Blob): Promise<void> {
  await withStore<void>('readwrite', store => store.put(file, id));
}

/** Loads a stored model file; null when absent. */
export async function getModelBlob(id: string): Promise<Blob | null> {
  const blob = await withStore<Blob | undefined>('readonly', store => store.get(id));
  return blob ?? null;
}

/** Deletes a stored model file. */
export async function deleteModelBlob(id: string): Promise<void> {
  await withStore<void>('readwrite', store => store.delete(id));
}

/** Every key currently held in the blob store. */
export async function listModelBlobKeys(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>('readonly', store => store.getAllKeys());
  return keys.filter((key): key is string => typeof key === 'string');
}
