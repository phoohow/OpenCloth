import { describe, expect, it } from 'vitest';
import { TargetPool } from '@/render/backend/targets';

describe('TargetPool', () => {
  it('multisamples only the scene color target', () => {
    const pool = new TargetPool();
    expect(pool.ensure({ width: 64, height: 48, traceWidth: 32, traceHeight: 24 })).toBe(true);

    expect(pool.color.samples).toBe(4);
    expect(pool.composite.samples).toBe(0);
    expect(pool.radiance.samples).toBe(0);
    expect(pool.color.depthTexture).not.toBeNull();
    pool.dispose();
  });

  it('keeps the sampling policy when the frame size changes', () => {
    const pool = new TargetPool();
    pool.ensure({ width: 64, height: 48, traceWidth: 32, traceHeight: 24 });
    const color = pool.color;

    expect(pool.ensure({ width: 128, height: 96, traceWidth: 64, traceHeight: 48 })).toBe(true);
    expect(pool.color).not.toBe(color);
    expect(pool.color.samples).toBe(4);
    expect(pool.composite.samples).toBe(0);
    pool.dispose();
  });
});
