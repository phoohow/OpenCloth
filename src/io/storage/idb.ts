const connections = new Map<string, Promise<IDBDatabase>>();

export interface IdbSpec {
  name: string;
  upgrade: (db: IDBDatabase, tx: IDBTransaction) => void;
}

const cacheKey = (spec: IdbSpec): string => spec.name;

export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openIdb(spec: IdbSpec): Promise<IDBDatabase> {
  const key = cacheKey(spec);
  const cached = connections.get(key);
  if (cached) return cached;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(spec.name);
    request.onupgradeneeded = () => {
      const tx = request.transaction;
      if (!tx) throw new Error(`数据库 ${spec.name} 升级时没有事务`);
      spec.upgrade(request.result, tx);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connections.delete(key);
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error(`无法打开本机数据库 ${spec.name}`));
    request.onblocked = () => {
      reject(new Error(`数据库 ${spec.name} 被其他标签页占用，请关闭其它 OpenCloth 页面后重试`));
    };
  });

  const guarded = opening.catch(error => {
    connections.delete(key);
    throw error;
  });
  connections.set(key, guarded);
  return guarded;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本机数据库请求失败'));
  });
}

export function withStores<T>(
  spec: IdbSpec, stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  return openIdb(spec).then(db => new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(stores, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let result: T | Promise<T>;
    try {
      result = run(transaction);
    } catch (error) {
      try { transaction.abort(); } catch {}
      reject(error);
      return;
    }

    transaction.oncomplete = () => { void Promise.resolve(result).then(resolve, reject); };
    transaction.onerror = () => reject(transaction.error ?? new Error('本机数据库事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本机数据库事务被中止'));
  }));
}

export function withStore<T>(
  spec: IdbSpec, store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withStores(spec, [store], mode, tx => requestResult(run(tx.objectStore(store))));
}

export async function readAll<T>(spec: IdbSpec, store: string): Promise<T[]> {
  return withStore(spec, store, 'readonly', s => s.getAll() as IDBRequest<T[]>);
}

export async function readOne<T>(spec: IdbSpec, store: string, key: IDBValidKey): Promise<T | null> {
  const value = await withStore<T | undefined>(spec, store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>);
  return value ?? null;
}

export async function readByIndex<T>(
  spec: IdbSpec, store: string, index: string, key: IDBValidKey,
): Promise<T[]> {
  return withStore(spec, store, 'readonly', s => s.index(index).getAll(key) as IDBRequest<T[]>);
}

export async function readKeys(spec: IdbSpec, store: string): Promise<IDBValidKey[]> {
  return withStore(spec, store, 'readonly', s => s.getAllKeys());
}

export async function putRecord(spec: IdbSpec, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  await withStore(spec, store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key)));
}

export async function deleteRecord(spec: IdbSpec, store: string, key: IDBValidKey): Promise<void> {
  await withStore(spec, store, 'readwrite', s => s.delete(key));
}

export function writeStore(spec: IdbSpec, store: string, run: (store: IDBObjectStore) => void): Promise<void> {
  return withStores(spec, [store], 'readwrite', tx => { run(tx.objectStore(store)); });
}
