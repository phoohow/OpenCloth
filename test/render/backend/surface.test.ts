import { describe, expect, it, vi } from 'vitest';
import { Surface } from '@/render/backend/surface';

/** Renderer stub that records setSize calls and serves the last logical size. */
function fakeRenderer() {
  let width = 0;
  let height = 0;
  return {
    setSize: vi.fn((nextWidth: number, nextHeight: number) => {
      width = nextWidth;
      height = nextHeight;
    }),
    getSize: (target: { x: number; y: number }) => {
      target.x = width;
      target.y = height;
      return target;
    },
  };
}

describe('Surface', () => {
  it('reconfigures the drawing buffer only when the logical size changes', () => {
    const renderer = fakeRenderer();
    const surface = new Surface({} as HTMLCanvasElement, renderer as never);

    surface.resize(800, 600);
    surface.resize(800, 600);
    surface.resize(800, 600);
    expect(renderer.setSize).toHaveBeenCalledTimes(1);
    expect(renderer.setSize).toHaveBeenLastCalledWith(800, 600, false);

    surface.resize(1024, 768);
    expect(renderer.setSize).toHaveBeenCalledTimes(2);
    expect(renderer.setSize).toHaveBeenLastCalledWith(1024, 768, false);
  });

  it('ignores empty sizes', () => {
    const renderer = fakeRenderer();
    const surface = new Surface({} as HTMLCanvasElement, renderer as never);
    surface.resize(0, 600);
    surface.resize(800, 0);
    expect(renderer.setSize).not.toHaveBeenCalled();
  });
});
