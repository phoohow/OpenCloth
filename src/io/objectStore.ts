/** IndexedDB store for imported model files, keyed by object id. */

const DB_NAME = 'oc-objects';
const STORE_NAME = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
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
