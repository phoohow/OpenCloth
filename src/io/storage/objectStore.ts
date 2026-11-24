import { deleteRecord, putRecord, readKeys, readOne, type IdbSpec } from '@/io/storage/idb';

const STORE_NAME = 'blobs';

const SPEC: IdbSpec = {
  name: 'oc-objects',
  upgrade: db => {
    db.createObjectStore(STORE_NAME);
  },
};

export function putModelBlob(id: string, file: Blob): Promise<void> {
  return putRecord(SPEC, STORE_NAME, file, id);
}

export function getModelBlob(id: string): Promise<Blob | null> {
  return readOne<Blob>(SPEC, STORE_NAME, id);
}

export function deleteModelBlob(id: string): Promise<void> {
  return deleteRecord(SPEC, STORE_NAME, id);
}

export async function listModelBlobKeys(): Promise<string[]> {
  const keys = await readKeys(SPEC, STORE_NAME);
  return keys.filter((key): key is string => typeof key === 'string');
}
