import { deleteRecord, putRecord, readAll, type IdbSpec } from '@/io/storage/idb';
import type { FabricAsset, TrimAsset } from '@/model';

const FABRIC_STORE = 'fabrics';
const TRIM_STORE = 'trims';
const TEMPLATE_STORE = 'templates';

/** One imported `.ocpat` kept as the original text. */
export interface PatternTemplateAsset {
  id: string;
  key: string;
  name: string;
  json: string;
  createdAt?: string;
}

/** Opened by `io/idb.ts`, which keeps the connection and creates the stores on first use. */
const SPEC: IdbSpec = {
  name: 'oc-assets',
  upgrade: db => {
    db.createObjectStore(FABRIC_STORE, { keyPath: 'id' });
    db.createObjectStore(TRIM_STORE, { keyPath: 'id' });
    db.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
  },
};

/** Saved assets of one store, newest first. */
async function listAssets<T extends { createdAt?: string }>(store: string): Promise<T[]> {
  const rows = await readAll<T>(SPEC, store);
  return rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Saved materials, newest first. */
export function listFabricAssets(): Promise<FabricAsset[]> {
  return listAssets<FabricAsset>(FABRIC_STORE);
}

/** Saves or replaces one material asset. */
export function saveFabricAsset(asset: FabricAsset): Promise<void> {
  return putRecord(SPEC, FABRIC_STORE, asset);
}

/** Removes one saved material asset. */
export function deleteFabricAsset(id: string): Promise<void> {
  return deleteRecord(SPEC, FABRIC_STORE, id);
}

/** Saved trim specs, newest first. */
export function listTrimAssets(): Promise<TrimAsset[]> {
  return listAssets<TrimAsset>(TRIM_STORE);
}

/** Saves or replaces one trim asset. */
export function saveTrimAsset(asset: TrimAsset): Promise<void> {
  return putRecord(SPEC, TRIM_STORE, asset);
}

/** Removes one saved trim asset. */
export function deleteTrimAsset(id: string): Promise<void> {
  return deleteRecord(SPEC, TRIM_STORE, id);
}

/** Saved garment template files, newest first. */
export function listPatternTemplateAssets(): Promise<PatternTemplateAsset[]> {
  return listAssets<PatternTemplateAsset>(TEMPLATE_STORE);
}

/** Saves or replaces one imported template file. */
export function savePatternTemplateAsset(asset: PatternTemplateAsset): Promise<void> {
  return putRecord(SPEC, TEMPLATE_STORE, asset);
}

/** Removes one imported template file. */
export function deletePatternTemplateAsset(id: string): Promise<void> {
  return deleteRecord(SPEC, TEMPLATE_STORE, id);
}
