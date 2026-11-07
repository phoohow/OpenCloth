import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { FrameTargets, type FrameSize } from '@/render/frame/targets';

/** One set of buffer sizes at the given drawing-buffer and trace size. */
function size(width: number, height: number, traceWidth = width, traceHeight = height): FrameSize {
  return { width, height, traceWidth, traceHeight };
}

describe('FrameTargets', () => {
  it('allocates the color, composite and radiance buffers', () => {
    const targets = new FrameTargets();

    expect(targets.ensure(size(100, 50, 50, 25))).toBe(true);
    expect(targets.color.width).toBe(100);
    expect(targets.color.height).toBe(50);
    expect(targets.composite.width).toBe(100);
    expect(targets.radiance.width).toBe(50);
    expect(targets.radiance.height).toBe(25);
    expect(targets.color.texture.type).toBe(THREE.HalfFloatType);
    expect(targets.color.texture.colorSpace).toBe(THREE.LinearSRGBColorSpace);
  });

  it('gives depth to the color buffer only', () => {
    const targets = new FrameTargets();
    targets.ensure(size(100, 50, 50, 25));

    expect(targets.color.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(targets.composite.depthTexture).toBeNull();
    expect(targets.radiance.depthTexture).toBeNull();
  });

  it('keeps the same targets while the size is unchanged', () => {
    const targets = new FrameTargets();
    targets.ensure(size(100, 50, 50, 25));
    const color = targets.color;

    expect(targets.ensure(size(100, 50, 50, 25))).toBe(false);
    expect(targets.color).toBe(color);
  });

  it('reallocates when the drawing or trace size changes', () => {
    const targets = new FrameTargets();
    targets.ensure(size(100, 50, 50, 25));
    const color = targets.color;

    expect(targets.ensure(size(120, 60, 50, 25))).toBe(true);
    expect(targets.color).not.toBe(color);
    expect(targets.color.width).toBe(120);

    expect(targets.ensure(size(120, 60, 60, 30))).toBe(true);
    expect(targets.radiance.width).toBe(60);
  });

  it('can be reallocated after disposal', () => {
    const targets = new FrameTargets();
    targets.ensure(size(100, 50, 50, 25));
    targets.dispose();

    expect(targets.ensure(size(100, 50, 50, 25))).toBe(true);
    expect(targets.color.width).toBe(100);
  });
});
