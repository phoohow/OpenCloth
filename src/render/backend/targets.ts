/** Persistent and transient render targets of the Backend layer. */

import * as THREE from 'three/webgpu';
import {
  asTargetHandle, asTextureHandle, type FrameSize, type TargetHandle, type TextureHandle,
} from '@/render/backend/types';

/** Coverage samples of the scene color target. */
const SCENE_SAMPLES = 4;

/** The color buffers a frame needs, plus the depth the first of them carries. */
export class TargetPool {
  /** Lit raster image; the only target with depth. */
  color!: TargetHandle;
  /** Raster image merged with traced radiance, linear. */
  composite!: TargetHandle;
  /** Path-traced radiance, linear HDR. */
  radiance!: TargetHandle;
  private depth: THREE.DepthTexture | null = null;
  private size: FrameSize | null = null;
  private readonly scratch: (THREE.RenderTarget | null)[] = [null, null];

  /** Reallocates when the size changed; returns whether it did. */
  ensure(size: FrameSize): boolean {
    const current = this.size;
    if (current
      && current.width === size.width && current.height === size.height
      && current.traceWidth === size.traceWidth && current.traceHeight === size.traceHeight) {
      return false;
    }
    this.dispose();
    this.size = { ...size };
    const depth = new THREE.DepthTexture(size.width, size.height);
    this.depth = depth;
    this.color = asTargetHandle(linearTarget(size.width, size.height, depth, SCENE_SAMPLES));
    this.composite = asTargetHandle(linearTarget(size.width, size.height, null));
    this.radiance = asTargetHandle(linearTarget(size.traceWidth, size.traceHeight, null));
    return true;
  }

  /** Texture view of a target, for programs that sample or blit it. */
  texture(target: TargetHandle): TextureHandle {
    return asTextureHandle(target.texture);
  }

  /** Scratch target of one parity, reallocated when the frame size changed. */
  scratchAt(
    index: number, width: number, height: number, type: THREE.TextureDataType = THREE.HalfFloatType,
  ): TargetHandle {
    const existing = this.scratch[index];
    if (existing && existing.width === width && existing.height === height) {
      return asTargetHandle(existing);
    }
    existing?.dispose();
    const target = new THREE.RenderTarget(width, height, { type, depthBuffer: false });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    this.scratch[index] = target;
    return asTargetHandle(target);
  }

  /** Frees every target, the scratch buffers and the depth the image carries. */
  dispose(): void {
    this.color?.dispose();
    this.composite?.dispose();
    this.radiance?.dispose();
    this.depth?.dispose();
    this.depth = null;
    this.size = null;
    for (const target of this.scratch) target?.dispose();
    this.scratch[0] = null;
    this.scratch[1] = null;
  }
}

/** Half-float linear target, with a depth attachment when one is given. */
function linearTarget(
  width: number, height: number, depth: THREE.DepthTexture | null, samples = 0,
): THREE.RenderTarget {
  const target = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: depth !== null,
    samples,
    ...(depth ? { depthTexture: depth } : {}),
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  return target;
}
