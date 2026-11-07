/** The post chain: the effects a mode asks for, run in the order it declares them. */

import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { drawFullScreen } from '@/render/frame/quad';
import type { FrameContext } from '@/render/frame/pass';
import type { PostEffect } from '@/render/frame/post/effect';
import { ToneMapEffect } from '@/render/frame/post/toneMap';
import type { PostEffectId } from '@/render/modes/spec';

/**
 * Holds one instance of every effect and runs the subset the mode declared. The chain is data:
 * a mode lists ids, and the order of that list is the order the image travels through.
 *
 * Whatever it runs, it ends with the processed image written into the frame color buffer, which is
 * also the target whose depth the overlays test against. An effect reads one texture and writes
 * another, so a chain of two needs a scratch target in between.
 */
export class PostChain {
  private readonly effects: ReadonlyMap<PostEffectId, PostEffect>;
  /** Targets the chain alternates through when more than one effect runs. */
  private readonly scratch: (THREE.RenderTarget | null)[] = [null, null];
  /** Effects taking part in the current frame; reused so a frame allocates no list. */
  private readonly activeEffects: PostEffect[] = [];
  /** Copy used when no effect claims the frame; rebuilt when the source texture changes. */
  private copy: THREE.MeshBasicNodeMaterial | null = null;
  private copySource: THREE.Texture | null = null;

  constructor() {
    this.effects = new Map<PostEffectId, PostEffect>([
      ['toneMap', new ToneMapEffect()],
    ]);
  }

  /** Runs the declared effects over the composite image and leaves the frame in the color buffer. */
  run(ctx: FrameContext, source: THREE.Texture): void {
    const chain = this.activeEffects;
    chain.length = 0;
    for (const id of ctx.spec.postProcess) {
      const effect = this.effects.get(id);
      if (effect && effect.enabled(ctx, source)) chain.push(effect);
    }

    // The color buffer holds the depth the overlays still need. Clearing it here would make every
    // overlay draw through the subject.
    const autoClear = ctx.renderer.autoClear;
    ctx.renderer.autoClear = false;
    try {
      if (chain.length === 0) {
        this.blit(ctx, source);
        return;
      }
      let image = source;
      for (let i = 0; i < chain.length; i++) {
        const last = i === chain.length - 1;
        const target = last ? ctx.targets.color : this.scratchAt(ctx, i % 2);
        chain[i]!.run(ctx, image, target);
        image = target.texture;
      }
    } finally {
      ctx.renderer.autoClear = autoClear;
    }
  }

  dispose(): void {
    for (const effect of this.effects.values()) effect.dispose();
    for (const target of this.scratch) target?.dispose();
    this.scratch[0] = null;
    this.scratch[1] = null;
    this.copy?.dispose();
    this.copy = null;
    this.copySource = null;
  }

  /** Scratch target of one parity, reallocated when the frame size changed. */
  private scratchAt(ctx: FrameContext, index: number): THREE.RenderTarget {
    const color = ctx.targets.color;
    const existing = this.scratch[index];
    if (existing && existing.width === color.width && existing.height === color.height) return existing;
    existing?.dispose();
    const target = new THREE.RenderTarget(color.width, color.height, {
      type: color.texture.type,
      depthBuffer: false,
    });
    target.texture.colorSpace = color.texture.colorSpace;
    this.scratch[index] = target;
    return target;
  }

  /** Puts the image on screen unchanged; the frame is still displayed when no effect runs. */
  private blit(ctx: FrameContext, source: THREE.Texture): void {
    if (!this.copy || this.copySource !== source) {
      this.copy?.dispose();
      const material = new THREE.MeshBasicNodeMaterial({
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      // Render-target textures are stored bottom-up; the quad's UV is not, so sampling flips.
      material.colorNode = texture(source, uv().flipY());
      this.copy = material;
      this.copySource = source;
    }
    drawFullScreen(ctx.renderer, this.copy, ctx.targets.color);
  }
}
