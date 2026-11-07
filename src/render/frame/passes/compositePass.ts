/** Pass 4: merges the raster image and the traced radiance into the composite buffer. */

import * as THREE from 'three/webgpu';
import { mix, texture, uniform, uv } from 'three/tsl';
import { drawFullScreen } from '@/render/frame/quad';
import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';

/**
 * The compositor. Two sources of one image: the raster scene colour and the path-traced radiance,
 * mixed by a weight that fades the traced image in as its sample pass matures.
 *
 * It always leaves the result in the composite buffer, even on a raster frame — there it is a
 * straight copy of the raster image. That is what lets the post chain keep its rule of "read one
 * image, write another": the color buffer goes on to receive the composite image in place, with the
 * depth the overlays still need.
 */
export class CompositePass implements FramePass {
  readonly id: PassId = 'composite';
  private readonly weight = uniform(0);
  private material: THREE.MeshBasicNodeMaterial | null = null;
  /** Sources the current material reads; a resize replaces the targets and their textures. */
  private builtSources: readonly (THREE.Texture | null)[] = [null, null];

  enabled(): boolean {
    return true;
  }

  run(ctx: FrameContext): void {
    const { renderer } = ctx;
    const raster = ctx.targets.color.texture;
    const radiance = ctx.trace.radiance;
    if (radiance && ctx.trace.weight > 0) {
      this.ensureMix(raster, radiance);
      this.weight.value = ctx.trace.weight;
      drawFullScreen(renderer, this.material!, ctx.targets.composite);
    } else {
      // Nothing to blend: the composite is the raster image, copied aside so the post chain can
      // write over the color buffer without reading the texture it draws into.
      renderer.setRenderTarget(null);
      renderer.copyTextureToTexture(raster, ctx.targets.composite.texture);
    }
    ctx.composite = ctx.targets.composite.texture;
  }

  dispose(): void {
    this.material?.dispose();
    this.material = null;
  }

  /**
   * Builds the mix material for this pair of sources. The weight stays a uniform, so holding on to
   * the material across frames costs nothing; it is replaced only when the textures themselves
   * change, because three caches the pipeline against the material object.
   */
  private ensureMix(raster: THREE.Texture, radiance: THREE.Texture): void {
    const [builtRaster, builtRadiance] = this.builtSources;
    if (this.material && builtRaster === raster && builtRadiance === radiance) return;
    this.material?.dispose();
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    // Render-target textures are stored bottom-up; the quad's UV is not, so sampling flips.
    material.colorNode = mix(
      texture(raster, uv().flipY()),
      texture(radiance, uv().flipY()),
      this.weight,
    );
    this.material = material;
    this.builtSources = [raster, radiance];
  }
}
