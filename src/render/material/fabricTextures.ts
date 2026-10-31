import * as THREE from 'three/webgpu';
import type { Vec2 } from '../../core/model/types';

/** Cache entry for one map data URL: the decode promise and the number of live handles. */
interface ImageEntry {
  refs: number;
  promise: Promise<HTMLImageElement | null>;
}

/** Decoded images keyed by data URL, so a rebind reuses the decode instead of parsing it again. */
const imageCache = new Map<string, ImageEntry>();
/** Image loads the exporters wait on before reading textures. */
const pendingLoads = new Set<Promise<HTMLImageElement | null>>();

/** Texture owned by one material for one map slot. */
export interface FabricTextureHandle {
  /** Decoded texture, null while the image is still loading. */
  readonly texture: THREE.Texture | null;
  /** Data URL the handle was created for. */
  readonly url: string;
  /** Applies the appearance's tiling and offset to the decoded texture. */
  setTransform(tiling: Vec2, offset: Vec2): void;
  /** Drops this handle's reference and frees the texture at the last one. */
  release(): void;
}

/** Starts loading a map data URL and returns a handle whose texture arrives once the image decodes. */
export function acquireFabricTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  tiling: Vec2,
  offset: Vec2,
  onReady: (texture: THREE.Texture) => void,
): FabricTextureHandle {
  const entry = acquireImage(url);
  let texture: THREE.Texture | null = null;
  let released = false;

  const applyTransform = () => {
    if (!texture) return;
    texture.repeat.set(tiling.x, tiling.y);
    texture.offset.set(offset.x, offset.y);
  };

  const bind = (image: HTMLImageElement | null) => {
    if (released || !image) return;
    texture = new THREE.Texture(image);
    texture.colorSpace = colorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    applyTransform();
    texture.needsUpdate = true;
    onReady(texture);
  };

  void entry.promise.then(bind);

  return {
    get texture() { return texture; },
    url,
    setTransform(nextTiling: Vec2, nextOffset: Vec2) {
      tiling = nextTiling;
      offset = nextOffset;
      applyTransform();
    },
    release() {
      if (released) return;
      released = true;
      texture?.dispose();
      texture = null;
      entry.refs -= 1;
      if (entry.refs <= 0) imageCache.delete(url);
    },
  };
}

/** Resolves after every map image requested so far has finished loading or failed. */
export async function whenFabricTexturesReady(): Promise<void> {
  while (pendingLoads.size > 0) await Promise.all([...pendingLoads]);
}

/** Increments the cache reference for a data URL, decoding it on first use. */
function acquireImage(url: string): ImageEntry {
  const cached = imageCache.get(url);
  if (cached) {
    cached.refs += 1;
    return cached;
  }
  const promise = loadImage(url);
  const entry: ImageEntry = { refs: 1, promise };
  imageCache.set(url, entry);
  pendingLoads.add(promise);
  void promise.then(() => pendingLoads.delete(promise));
  return entry;
}

/** Loads a data URL into an image element; a broken image resolves null so the cloth keeps shading. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
