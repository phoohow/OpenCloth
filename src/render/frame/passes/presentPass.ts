/** Stage 7: the resolved image to the canvas. */

import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { drawFullScreen } from '@/render/frame/quad';
import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';

/**
 * Blits the frame image to the drawing buffer.
 *
 * Every full-screen read of a render target flips, because the texture is stored bottom-up while
 * the quad's UV is not. The flip is applied here exactly as in the composite and tone-map stages,
 * so everything that reaches the target keeps the same orientation.
 */
export class PresentPass implements FramePass {
  readonly id: PassId = 'present';
  private material: THREE.MeshBasicNodeMaterial | null = null;
  /** Source the current material reads; a resize replaces the target and therefore the texture. */
  private builtSource: THREE.Texture | null = null;

  enabled(): boolean {
    return true;
  }

  run(ctx: FrameContext): void {
    const source = ctx.targets.image.texture;
    // A new material, not a new `colorNode`: three caches the pipeline against the material, so
    // rebinding a texture by assignment would keep drawing the old (disposed) one.
    if (!this.material || source !== this.builtSource) {
      this.material?.dispose();
      const material = new THREE.MeshBasicNodeMaterial({
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      material.colorNode = texture(source, uv().flipY());
      this.material = material;
      this.builtSource = source;
    }
    drawFullScreen(ctx.device.renderer, this.material, null);
  }

  dispose(): void {
    this.material?.dispose();
    this.material = null;
  }
}
