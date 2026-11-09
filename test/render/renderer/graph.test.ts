import { describe, expect, it } from 'vitest';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';
import { FrameGraph } from '@/render/renderer/frame/graph';

/** A pass recording that it ran, with no GPU work. */
function pass(id: string, slot: RenderPass['slot'], enabled = true): RenderPass & { runs: number } {
  return {
    id,
    slot,
    runs: 0,
    reads: [],
    writes: [],
    enabled: () => enabled,
    execute() { this.runs += 1; },
  };
}

const ctx = {} as PassContext;
const conditions = {} as FrameConditions;

describe('FrameGraph', () => {
  it('runs passes in slot order regardless of construction order', () => {
    const present = pass('present', 'present');
    const raster = pass('raster', 'raster');
    const overlay = pass('overlay', 'overlay');
    const graph = new FrameGraph([present, overlay, raster]);

    expect(graph.execute(conditions, p => p.execute(ctx))).toEqual(['raster', 'overlay', 'present']);
  });

  it('skips disabled passes and keeps the order of the rest', () => {
    const raster = pass('raster', 'raster');
    const composite = pass('composite', 'composite', false);
    const post = pass('post', 'post');
    const graph = new FrameGraph([post, composite, raster]);

    expect(graph.execute(conditions, p => p.execute(ctx))).toEqual(['raster', 'post']);
    expect(composite.runs).toBe(0);
    expect(post.runs).toBe(1);
  });

  it('asks each pass about the current frame context', () => {
    const seen: unknown[] = [];
    const probe: RenderPass = {
      id: 'probe',
      slot: 'present',
      reads: [],
      writes: [],
      enabled(context) {
        seen.push(context);
        return true;
      },
      execute() { /* no work */ },
    };
    new FrameGraph([probe]).execute(conditions, p => p.execute(ctx));

    expect(seen).toEqual([conditions]);
  });

  it('rejects a pass that reads a resource no earlier pass wrote', () => {
    const post: RenderPass = {
      id: 'post', slot: 'post', reads: ['composite'], writes: ['color'],
      enabled: () => true, execute() { /* no work */ },
    };
    expect(() => new FrameGraph([post]).execute(conditions, p => p.execute(ctx)))
      .toThrow(/reads "composite"/);
  });

  it('accepts a read satisfied by an earlier pass write', () => {
    const raster: RenderPass = {
      id: 'raster', slot: 'raster', reads: [], writes: ['color'],
      enabled: () => true, execute() { /* no work */ },
    };
    const overlay: RenderPass = {
      id: 'overlay', slot: 'overlay', reads: ['color'], writes: ['color'],
      enabled: () => true, execute() { /* no work */ },
    };
    expect(new FrameGraph([overlay, raster]).execute(conditions, p => p.execute(ctx)))
      .toEqual(['raster', 'overlay']);
  });

  it('treats surface and radiance as resident inputs', () => {
    const composite: RenderPass = {
      id: 'composite', slot: 'composite', reads: ['radiance'], writes: ['composite'],
      enabled: () => true, execute() { /* no work */ },
    };
    const present: RenderPass = {
      id: 'present', slot: 'present', reads: ['surface'], writes: [],
      enabled: () => true, execute() { /* no work */ },
    };
    expect(new FrameGraph([present, composite]).execute(conditions, p => p.execute(ctx)))
      .toEqual(['composite', 'present']);
  });
});
