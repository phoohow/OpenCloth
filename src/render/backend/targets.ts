import {
  asTargetHandle, asTextureHandle, type FrameSize, type TargetHandle, type TextureHandle,
} from '@/render/backend/types';
import * as THREE from 'three/webgpu';

const SCENE_SAMPLES = 4;

export type ScratchFormat = 'linear' | 'display';

interface ScratchSlot {
  readonly target: THREE.RenderTarget;
  readonly format: ScratchFormat;
}

export class TargetPool {
  color!: TargetHandle;
  composite!: TargetHandle;
  radiance!: TargetHandle;
  private depth: THREE.DepthTexture | null = null;
  private size: FrameSize | null = null;
  private readonly scratch: (ScratchSlot | null)[] = [null, null];

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

  texture(target: TargetHandle): TextureHandle {
    return asTextureHandle(target.texture);
  }

  scratchAt(
    index: number, width: number, height: number, format: ScratchFormat = 'linear',
  ): TargetHandle {
    const existing = this.scratch[index];
    if (existing && existing.format === format
      && existing.target.width === width && existing.target.height === height) {
      return asTargetHandle(existing.target);
    }

    existing?.target.dispose();
    const display = format === 'display';
    const target = new THREE.RenderTarget(width, height, {
      type: display ? THREE.UnsignedByteType : THREE.HalfFloatType,
      depthBuffer: false,
    });
    target.texture.colorSpace = display ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    this.scratch[index] = { target, format };
    return asTargetHandle(target);
  }

  dispose(): void {
    this.color?.dispose();
    this.composite?.dispose();
    this.radiance?.dispose();
    this.depth?.dispose();
    this.depth = null;
    this.size = null;
    for (const slot of this.scratch) slot?.target.dispose();
    this.scratch[0] = null;
    this.scratch[1] = null;
  }
}

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
