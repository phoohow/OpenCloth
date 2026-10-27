import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  CAMERA_VIEW_FRAMES, FIT_MARGIN, fitCameraToBox, orthoFitViewHeight,
  perspectiveFitDistance, projectBox,
} from '../../../src/core/engine/cameraFit';

(globalThis as unknown as { self: unknown }).self ??= globalThis;

const box = (size: [number, number, number], center: [number, number, number] = [0, 0, 0]): THREE.Box3 => {
  const half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
  const mid = new THREE.Vector3(...center);
  return new THREE.Box3(mid.clone().sub(half), mid.clone().add(half));
};

describe('projectBox', () => {
  it('measures the box along the view axes of a head-on frame', () => {
    const extents = projectBox(box([1, 2, 1]), CAMERA_VIEW_FRAMES.front);
    expect(extents.width).toBeCloseTo(0.5);
    expect(extents.height).toBeCloseTo(1);
    expect(extents.depth).toBeCloseTo(0.5);
  });

  it('swaps the vertical extent for depth in the top view', () => {
    const extents = projectBox(box([1, 2, 4]), CAMERA_VIEW_FRAMES.top);
    expect(extents.width).toBeCloseTo(0.5);
    expect(extents.height).toBeCloseTo(2);
    expect(extents.depth).toBeCloseTo(1);
  });

  it('widens a cube when viewed from a 45-degree corner', () => {
    const front = projectBox(box([1, 1, 1]), CAMERA_VIEW_FRAMES.front);
    const corner = projectBox(box([1, 1, 1]), CAMERA_VIEW_FRAMES.frontRight);
    expect(corner.width).toBeCloseTo(Math.SQRT2 / 2);
    expect(corner.width).toBeGreaterThan(front.width);
  });

  it('keeps the view centred on the box regardless of where it sits', () => {
    const shifted = projectBox(box([1, 2, 1], [3, 9, -2]), CAMERA_VIEW_FRAMES.left);
    const centred = projectBox(box([1, 2, 1]), CAMERA_VIEW_FRAMES.left);
    expect(shifted).toEqual(centred);
  });
});

describe('perspectiveFitDistance', () => {
  const extents = projectBox(box([1, 2, 1]), CAMERA_VIEW_FRAMES.front);

  it('clears the nearest corner of the box at the binding vertical field', () => {
    expect(perspectiveFitDistance(extents, 45, 1)).toBeCloseTo((1 / Math.tan(THREE.MathUtils.degToRad(22.5)) + 0.5) * FIT_MARGIN);
  });

  it('pushes the camera back for a portrait viewport, which a fixed radius never did', () => {
    const portrait = perspectiveFitDistance({ ...extents, width: 4 }, 45, 0.6);
    const landscape = perspectiveFitDistance({ ...extents, width: 4 }, 45, 2);
    expect(portrait).toBeGreaterThan(landscape);
  });

  it('widens the field of view by moving closer', () => {
    expect(perspectiveFitDistance(extents, 70, 1)).toBeLessThan(perspectiveFitDistance(extents, 30, 1));
  });
});

describe('orthoFitViewHeight', () => {
  it('spans the projected height of the box', () => {
    expect(orthoFitViewHeight(projectBox(box([1, 2, 1]), CAMERA_VIEW_FRAMES.front), 1))
      .toBeCloseTo(2 * FIT_MARGIN);
  });

  it('grows the height until a wide box fits the narrow viewport width', () => {
    const wide = projectBox(box([4, 1, 1]), CAMERA_VIEW_FRAMES.front);
    expect(orthoFitViewHeight(wide, 0.5)).toBeCloseTo((4 / 0.5) * FIT_MARGIN);
    expect(orthoFitViewHeight(wide, 4)).toBeCloseTo(1 * FIT_MARGIN);
  });
});

describe('fitCameraToBox', () => {
  it('frames the whole body from every preset direction', () => {
    const body = box([0.6, 1.8, 0.4], [0, 0.9, 0]);
    for (const [name, frame] of Object.entries(CAMERA_VIEW_FRAMES)) {
      const fit = fitCameraToBox(body, frame, 45, 1.5);
      const extents = projectBox(body, frame);
      // Both view planes must stay inside the frustum the fit reports.
      const vertical = Math.tan(THREE.MathUtils.degToRad(22.5)) * (fit.distance - extents.depth);
      expect(vertical, name).toBeGreaterThanOrEqual(extents.height);
      expect(fit.viewHeight / 2, name).toBeGreaterThanOrEqual(extents.height);
      expect(fit.viewHeight / 2 * 1.5, name).toBeGreaterThanOrEqual(extents.width);
    }
  });
});

describe('CAMERA_VIEW_FRAMES', () => {
  it('offers six axis views plus four 45-degree corners', () => {
    expect(Object.keys(CAMERA_VIEW_FRAMES)).toHaveLength(10);
  });

  it('uses unit directions with an up vector perpendicular to them', () => {
    for (const [name, frame] of Object.entries(CAMERA_VIEW_FRAMES)) {
      expect(frame.direction.length(), name).toBeCloseTo(1);
      expect(Math.abs(frame.direction.dot(frame.up)), name).toBeLessThan(1e-6);
    }
  });

  it('keeps opposite presets on opposite sides of the scene', () => {
    const frontBack = CAMERA_VIEW_FRAMES.front.direction.clone().add(CAMERA_VIEW_FRAMES.back.direction);
    expect(frontBack.length()).toBeCloseTo(0);
    expect(CAMERA_VIEW_FRAMES.top.direction.z).toBe(0);
  });
});
