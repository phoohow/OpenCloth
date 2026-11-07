import * as THREE from 'three/webgpu';
import type { Vec2 } from '@/model/types';
import { retainImage } from '@/common/platform';

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
  const lease = retainImage(url);
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

  void lease.ready.then(bind);

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
      lease.release();
    },
  };
}
