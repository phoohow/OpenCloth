import type { FabricAsset, TrimAsset } from '@/model';

import { deleteRecord, putRecord, readAll, type IdbSpec } from '@/io/storage/idb';

const FABRIC_STORE = 'fabrics';

const TRIM_STORE = 'trims';

const TEMPLATE_STORE = 'templates';

const SPEC: IdbSpec = {
  name: 'oc-assets',
  upgrade: db => {
    db.createObjectStore(FABRIC_STORE, { keyPath: 'id' });
    db.createObjectStore(TRIM_STORE, { keyPath: 'id' });
    db.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
  },
};

export interface PatternTemplateAsset {
  id: string;
  key: string;
  name: string;
  json: string;
  createdAt?: string;
}

async function listAssets<T extends { createdAt?: string }>(store: string): Promise<T[]> {
  const rows = await readAll<T>(SPEC, store);
  return rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export function listFabricAssets(): Promise<FabricAsset[]> {
  return listAssets<FabricAsset>(FABRIC_STORE);
}

export function deleteFabricAsset(id: string): Promise<void> {
  return deleteRecord(SPEC, FABRIC_STORE, id);
}

export function listTrimAssets(): Promise<TrimAsset[]> {
  return listAssets<TrimAsset>(TRIM_STORE);
}

export function deleteTrimAsset(id: string): Promise<void> {
  return deleteRecord(SPEC, TRIM_STORE, id);
}

export function listPatternTemplateAssets(): Promise<PatternTemplateAsset[]> {
  return listAssets<PatternTemplateAsset>(TEMPLATE_STORE);
}

export function savePatternTemplateAsset(asset: PatternTemplateAsset): Promise<void> {
  return putRecord(SPEC, TEMPLATE_STORE, asset);
}

export function deletePatternTemplateAsset(id: string): Promise<void> {
  return deleteRecord(SPEC, TEMPLATE_STORE, id);
}
