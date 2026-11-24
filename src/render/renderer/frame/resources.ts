import type { TargetPool } from '@/render/backend/targets';
import type { TargetHandle, TextureHandle } from '@/render/backend/types';
import type { FrameResources, FrameSize } from '@/render/renderer/frame/pass';

export class RendererFrameResources implements FrameResources {
  constructor(private readonly targets: TargetPool) {}

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
}
