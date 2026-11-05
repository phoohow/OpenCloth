/**
 * Shared IndexedDB plumbing for the four local stores (`oc-projects`, `oc-objects`,
 * `oc-review`, `oc-assets`). One cached connection per database, one place that knows
 * how a transaction resolves, and one naming rule for schema upgrades.
 */

/** One database: name, schema version and the schema work that runs on upgrade. */
export interface IdbSpec {
  name: string;
  version: number;
  /**
   * Creates the stores and indexes this version needs. Runs inside the upgrade
   * transaction, so existing stores must be reached through `tx`, not `db.transaction`.
   */
  upgrade: (db: IDBDatabase, tx: IDBTransaction) => void;
}

/** Cached connections, keyed by `name@version` so two specs never share a stale handle. */
const connections = new Map<string, Promise<IDBDatabase>>();

const cacheKey = (spec: IdbSpec): string => `${spec.name}@${spec.version}`;

/** True when the browser exposes IndexedDB; every store checks this before touching it. */
export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Opens a database and keeps the connection for later calls. A `versionchange` from
 * another tab closes and forgets it, so the next call reopens at the new version.
 */
export function openIdb(spec: IdbSpec): Promise<IDBDatabase> {
  const key = cacheKey(spec);
  const cached = connections.get(key);
  if (cached) return cached;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(spec.name, spec.version);
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

  // A failed open must not stay cached, or every later call inherits the failure.
  const guarded = opening.catch(error => {
    connections.delete(key);
    throw error;
  });
  connections.set(key, guarded);
  return guarded;
}

/** Drops every cached connection; used when a store is deleted or a schema is reset. */
export function closeIdb(): void {
  for (const opening of connections.values()) {
    void opening.then(db => db.close()).catch(() => { });
  }
  connections.clear();
}

/** Resolves one request, keeping the IndexedDB result type. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本机数据库请求失败'));
  });
}

/**
 * Runs one transaction and resolves with what `run` returned once it commits.
 * `run` may return a promise (a body of several requests); a thrown error aborts it.
 */
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
      try { transaction.abort(); } catch { /* already finished */ }
      reject(error);
      return;
    }

    transaction.oncomplete = () => { void Promise.resolve(result).then(resolve, reject); };
    transaction.onerror = () => reject(transaction.error ?? new Error('本机数据库事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本机数据库事务被中止'));
  }));
}

/** Runs a body against a cached connection; the connection stays open for the next call. */
export async function withDb<T>(spec: IdbSpec, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openIdb(spec);
  return run(db);
}

/** Runs one request against a single store and resolves once its transaction commits. */
export function withStore<T>(
  spec: IdbSpec, store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withStores(spec, [store], mode, tx => requestResult(run(tx.objectStore(store))));
}

/** Every record of one store. */
export async function readAll<T>(spec: IdbSpec, store: string): Promise<T[]> {
  return withStore(spec, store, 'readonly', s => s.getAll() as IDBRequest<T[]>);
}

/** One record by key; null when the store has no such record. */
export async function readOne<T>(spec: IdbSpec, store: string, key: IDBValidKey): Promise<T | null> {
  const value = await withStore<T | undefined>(spec, store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>);
  return value ?? null;
}

/** Records whose `index` value equals `key`. */
export async function readByIndex<T>(
  spec: IdbSpec, store: string, index: string, key: IDBValidKey,
): Promise<T[]> {
  return withStore(spec, store, 'readonly', s => s.index(index).getAll(key) as IDBRequest<T[]>);
}

/** Every key of one store. */
export async function readKeys(spec: IdbSpec, store: string): Promise<IDBValidKey[]> {
  return withStore(spec, store, 'readonly', s => s.getAllKeys());
}

/** Writes one record; `key` is omitted for stores that declare a `keyPath`. */
export async function putRecord(spec: IdbSpec, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  await withStore(spec, store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key)));
}

/** Deletes one record by key. */
export async function deleteRecord(spec: IdbSpec, store: string, key: IDBValidKey): Promise<void> {
  await withStore(spec, store, 'readwrite', s => s.delete(key));
}

/** Runs a body of queued writes in one transaction on a single store. */
export function writeStore(spec: IdbSpec, store: string, run: (store: IDBObjectStore) => void): Promise<void> {
  return withStores(spec, [store], 'readwrite', tx => { run(tx.objectStore(store)); });
}
