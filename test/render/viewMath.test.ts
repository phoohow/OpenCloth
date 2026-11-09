import { describe, expect, it } from 'vitest';
import type { CameraState } from '@/render/common';
import {
  cameraBasis, projectWorldToNdc, projectWorldToScreen, worldUnitsPerPixel,
} from '@/render/common';

const CAMERA: CameraState = {
  projection: 'perspective',
  position: { x: 0, y: 0, z: 3 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovDeg: 45,
  viewHeightMeters: 2,
  aspect: 1.6,
  near: 0.1,
  far: 100,
};

describe('render/common viewMath', () => {
  it('builds a right-handed view basis', () => {
    const basis = cameraBasis(CAMERA)!;
    expect(basis.right.x).toBeCloseTo(1);
    expect(basis.right.y).toBeCloseTo(0);
    expect(basis.up.y).toBeCloseTo(1);
    expect(basis.forward.z).toBeCloseTo(-1);
    expect(basis.back.z).toBeCloseTo(1);
  });

  it('projects the camera target to the viewport centre', () => {
    const ndc = projectWorldToNdc({ x: 0, y: 0, z: 0 }, CAMERA)!;
    expect(Math.abs(ndc.x)).toBeLessThan(1e-9);
    expect(Math.abs(ndc.y)).toBeLessThan(1e-9);
    const screen = projectWorldToScreen({ x: 0, y: 0, z: 0 }, CAMERA, 800, 600)!;
    expect(Math.abs(screen.x - 400)).toBeLessThan(1e-9);
    expect(Math.abs(screen.y - 300)).toBeLessThan(1e-9);
    expect(Math.abs(screen.depth - 3)).toBeLessThan(1e-9);
  });

  it('rejects points behind the camera', () => {
    expect(projectWorldToNdc({ x: 0, y: 0, z: 5 }, CAMERA)).toBeNull();
  });

  it('handles orthographic projection without a depth-dependent size', () => {
    const ortho: CameraState = { ...CAMERA, projection: 'orthographic', viewHeightMeters: 4 };
    const nearScreen = projectWorldToScreen({ x: 1, y: 0, z: 0 }, ortho, 800, 600)!;
    const farScreen = projectWorldToScreen({ x: 1, y: 0, z: -2 }, ortho, 800, 600)!;
    expect(nearScreen.x).toBeCloseTo(farScreen.x);
    expect(worldUnitsPerPixel(ortho, { x: 0, y: 0, z: 0 }, 600)).toBeCloseTo(4 / 600);
  });
});
