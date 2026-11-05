/** Supplies the WebGPU device without exposing a renderer's private fields. */
export interface GpuDeviceProvider { device(): GPUDevice }

/** Minimal key-value storage, implemented by localStorage or an in-memory stand-in. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Wall clock injected into timing and sampling code. */
export interface Clock { now(): number }

/** Log sink for libraries that must not call console directly. */
export interface Logger { log(message: string): void }

/** Binary asset store used by model and image loaders. */
export interface AssetStore {
  get(key: string): Promise<Blob | null>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
