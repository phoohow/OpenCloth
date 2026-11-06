/** Tone mapping: the step that turns linear radiance into a display image. */

import * as THREE from 'three/webgpu';
import { texture, uv, vec4 } from 'three/tsl';
import type { ToneMappingMode } from '@/model/types';
import { drawFullScreen } from '@/render/frame/quad';
import type { FrameContext } from '@/render/frame/pass';
import type { PostEffect } from '@/render/frame/post/effect';
import type { PostEffectId } from '@/render/modes/spec';

/**
 * Writes the image the chain hands it into the target the chain hands it, with the project's tone
 * mapping curve applied.
 *
 * The curves are written out here rather than delegated to three's tone mapping node: that node
 * resolves its function through the renderer's node library and falls back to the raw colour when
 * the lookup misses, which shows up as "the tone mapping setting does nothing".
 *
 * The stage sits first in the post chain because it is what turns linear values into display
 * values, and everything after it — overlays, gizmos — authors colours that are already display
 * referred and must not be mapped again.
 */
export class ToneMapEffect implements PostEffect {
  readonly id: PostEffectId = 'toneMap';
  private material: THREE.MeshBasicNodeMaterial | null = null;
  private builtCurve: ToneMappingMode | null = null;
  private builtSource: THREE.Texture | null = null;
  private builtExposure: number | null = null;

  enabled(): boolean {
    return true;
  }

  run(ctx: FrameContext, source: THREE.Texture, target: THREE.RenderTarget): void {
    const curve = ctx.spec.toneMapping;
    const exposure = ctx.device.renderer.toneMappingExposure;
    if (!this.material
      || curve !== this.builtCurve
      || source !== this.builtSource
      || exposure !== this.builtExposure) {
      this.rebuild(source, curve, exposure);
    }
    drawFullScreen(ctx.device.renderer, this.material!, target);
  }

  dispose(): void {
    this.material?.dispose();
    this.material = null;
  }

  /**
   * Builds a fresh material for this curve.
   *
   * Replacing the material rather than reassigning `colorNode` is deliberate: three caches the
   * pipeline against the material, and a node object contributes nothing distinguishing to that
   * cache key, so an updated graph would never be compiled — the first curve would stay in place
   * and the setting would look inert.
   */
  private rebuild(source: THREE.Texture, curve: ToneMappingMode, exposure: number): void {
    this.material?.dispose();
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    // Render-target textures are stored bottom-up; the quad's UV is not, so sampling flips.
    const exposed = texture(source, uv().flipY()).rgb.mul(exposure);
    let mapped = exposed;
    if (curve === 'linear') {
      mapped = exposed.clamp(0, 1);
    } else if (curve === 'reinhard') {
      mapped = exposed.div(exposed.add(1)).clamp(0, 1);
    } else if (curve === 'aces') {
      // ACES filmic, the Narkowicz fit three also uses.
      const numerator = exposed.mul(exposed.mul(2.51).add(0.03));
      const denominator = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
      mapped = numerator.div(denominator).clamp(0, 1);
    }
    material.colorNode = vec4(mapped, 1);
    this.material = material;
    this.builtCurve = curve;
    this.builtSource = source;
    this.builtExposure = exposure;
  }
}
