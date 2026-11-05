import { requestResult, withDb, type IdbSpec } from './idb';
import type { FabricAsset, TrimAsset } from '../core/model/assetLibrary';

const FABRIC_STORE = 'fabrics';
const TRIM_STORE = 'trims';

/** Opened by `io/idb.ts`, which keeps the connection and creates both stores on first use. */
const SPEC: IdbSpec = {
  name: 'oc-assets',
  version: 1,
  upgrade: db => {
    if (!db.objectStoreNames.contains(FABRIC_STORE)) db.createObjectStore(FABRIC_STORE, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(TRIM_STORE)) db.createObjectStore(TRIM_STORE, { keyPath: 'id' });
  },
};

/** Saved materials, newest first. */
export async function listFabricAssets(): Promise<FabricAsset[]> {
  return withDb(SPEC, async db => (await requestResult(
    db.transaction(FABRIC_STORE, 'readonly').objectStore(FABRIC_STORE).getAll() as IDBRequest<FabricAsset[]>,
  )).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
}

/** Saves or replaces one material asset. */
export async function saveFabricAsset(asset: FabricAsset): Promise<void> {
  await withDb(SPEC, db => requestResult(db.transaction(FABRIC_STORE, 'readwrite').objectStore(FABRIC_STORE).put(asset))
    .then(() => undefined));
}

/** Removes one saved material asset. */
export async function deleteFabricAsset(id: string): Promise<void> {
  await withDb(SPEC, db => requestResult(db.transaction(FABRIC_STORE, 'readwrite').objectStore(FABRIC_STORE).delete(id))
    .then(() => undefined));
}

/** Saved trim specs, newest first. */
export async function listTrimAssets(): Promise<TrimAsset[]> {
  return withDb(SPEC, async db => (await requestResult(
    db.transaction(TRIM_STORE, 'readonly').objectStore(TRIM_STORE).getAll() as IDBRequest<TrimAsset[]>,
  )).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
}

/** Saves or replaces one trim asset. */
export async function saveTrimAsset(asset: TrimAsset): Promise<void> {
  await withDb(SPEC, db => requestResult(db.transaction(TRIM_STORE, 'readwrite').objectStore(TRIM_STORE).put(asset))
    .then(() => undefined));
}

/** Removes one saved trim asset. */
export async function deleteTrimAsset(id: string): Promise<void> {
  await withDb(SPEC, db => requestResult(db.transaction(TRIM_STORE, 'readwrite').objectStore(TRIM_STORE).delete(id))
    .then(() => undefined));
}
