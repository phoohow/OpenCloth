/** Frame-owned resources over the backend target pool. */

import type { TargetPool } from '@/render/backend/targets';
import type { TargetHandle, TextureHandle } from '@/render/backend/types';
import type { FrameResources, FrameSize } from '@/render/renderer/frame/pass';

/** Implements the pass resource contract over the backend targets. */
export class RendererFrameResources implements FrameResources {
  constructor(private readonly targets: TargetPool) { }

  get color(): TargetHandle {
    return this.targets.color;
  }

  get composite(): TargetHandle {
    return this.targets.composite;
  }

  get radiance(): TargetHandle {
    return this.targets.radiance;
  }

  texture(target: TargetHandle): TextureHandle {
    return this.targets.texture(target);
  }

  ensure(size: FrameSize): void {
    this.targets.ensure(size);
  }

  scratch(index: number): TargetHandle {
    return this.targets.scratchAt(index, this.targets.radiance.width, this.targets.radiance.height);
  }
}
