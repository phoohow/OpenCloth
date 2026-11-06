/** What a post effect reads, what it writes, and the shape every effect has. */

import type * as THREE from 'three/webgpu';
import type { FrameContext } from '@/render/frame/pass';
import type { PostEffectId } from '@/render/modes/spec';

/**
 * One stage of the post chain.
 *
 * The chain hands each effect the image to read and the target to write, two different ones: an
 * effect can never read and write the same texture. The chain therefore alternates between scratch
 * targets when more than one effect runs, and lands the last one in the frame image target.
 */
export interface PostEffect {
  readonly id: PostEffectId;
  /** Whether this effect applies to the image it was handed. */
  enabled(ctx: FrameContext, source: THREE.Texture): boolean;
  /** Draws `source` with this effect applied into `target`. */
  run(ctx: FrameContext, source: THREE.Texture, target: THREE.RenderTarget): void;
  dispose(): void;
}
