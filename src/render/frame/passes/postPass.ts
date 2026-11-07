/** Pass 5: the post chain, run over the image the compositor produced. */

import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';
import type { PostChain } from '@/render/frame/post/chain';

/**
 * Hands the composite image to the post chain, which writes it into the frame color buffer. Tone mapping lives
 * here, which is why the overlays are drawn after this pass: their colours are display referred
 * and must not be mapped again.
 */
export class PostPass implements FramePass {
  readonly id: PassId = 'post';

  constructor(private readonly chain: PostChain) { }

  enabled(ctx: FrameContext): boolean {
    return ctx.composite !== null;
  }

  run(ctx: FrameContext): void {
    const source = ctx.composite;
    if (!source) return;
    this.chain.run(ctx, source);
  }
}
