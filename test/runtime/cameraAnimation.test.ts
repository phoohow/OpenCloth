import { describe, expect, it } from 'vitest';
import type { CameraHost, CameraPose, Ray } from '@/render/common';
import type { CameraAnimationConfig, CameraConfig } from '@/model/types';
import { normalizeCameraAnimation } from '@/model';
import { cameraAnimationPose } from '@/runtime/cameraAnimation';
import { CameraRig } from '@/runtime/cameraRig';

/** Camera four meters in front of the origin, looking at it. */
const BASE: CameraConfig = {
  projection: 'perspective',
  position: { x: 0, y: 0, z: 4 },
  target: { x: 0, y: 0, z: 0 },
  fovDeg: 45,
  viewHeightMeters: 2,
};

/** Move with overrides applied, one second per quarter cycle. */
function move(patch: Partial<CameraAnimationConfig> = {}): CameraAnimationConfig {
  return { kind: 'orbit', enabled: true, periodSec: 4, amplitude: 90, ...patch };
}

function distance(camera: CameraConfig): number {
  const { position, target } = camera;
  return Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
}

/** Host that stores the last pose it was given and notifies its listeners. */
function fakeHost(start: CameraConfig) {
  let state: CameraConfig = { ...start };
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const host: CameraHost = {
    update() { },
    frame() { },
    snapshot: (aspect = 1.5) => ({
      ...state, up: { x: 0, y: 1, z: 0 }, aspect, near: 0.1, far: 100,
    }),
    projection: () => state.projection,
    setProjection(projection) {
      state = { ...state, projection };
      emit();
    },
    setPose(pose: CameraPose) {
      state = {
        projection: pose.projection, position: pose.position, target: pose.target,
        fovDeg: pose.fovDeg, viewHeightMeters: pose.viewHeightMeters,
      };
      emit();
    },
    ray: (): Ray => ({ origin: state.position, direction: { x: 0, y: 0, z: -1 } }),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return { host, camera: () => state };
}

const BOUNDS = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

describe('cameraAnimationPose', () => {
  it('starts on the stored placement', () => {
    const pose = cameraAnimationPose(BASE, move(), 0);
    expect(pose.position).toEqual(BASE.position);
    expect(pose.target).toEqual(BASE.target);
  });

  it('orbits the target on one radius', () => {
    const quarter = cameraAnimationPose(BASE, move(), 1);
    expect(quarter.target).toEqual(BASE.target);
    expect(distance(quarter)).toBeCloseTo(4, 6);
    expect(quarter.position.x).toBeCloseTo(4, 6);
    expect(quarter.position.z).toBeCloseTo(0, 6);
  });

  it('dollies along the view line and keeps a minimum distance', () => {
    const out = cameraAnimationPose(BASE, move({ kind: 'dolly', amplitude: 1 }), 1);
    expect(distance(out)).toBeCloseTo(5, 6);
    const inside = cameraAnimationPose(BASE, move({ kind: 'dolly', amplitude: 10 }), 3);
    expect(distance(inside)).toBeCloseTo(0.2, 6);
  });

  it('pans the eye and the target together', () => {
    const out = cameraAnimationPose(BASE, move({ kind: 'pan', amplitude: 0.5 }), 1);
    expect(out.target).toEqual({ x: 0.5, y: 0, z: 0 });
    expect(out.position).toEqual({ x: 0.5, y: 0, z: 4 });
  });

  it('cranes both along the vertical axis', () => {
    const out = cameraAnimationPose(BASE, move({ kind: 'crane', amplitude: 0.5 }), 1);
    expect(out.target).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(out.position).toEqual({ x: 0, y: 0.5, z: 4 });
  });
});

describe('CameraRig animation', () => {
  it('advances the move and returns to the stored placement when it stops', () => {
    const { host, camera } = fakeHost(BASE);
    const rig = new CameraRig({ host, bounds: () => BOUNDS });

    rig.setAnimation(move());
    expect(rig.isAnimating()).toBe(true);
    expect(rig.advanceAnimation(1000)).toBe(true);
    expect(camera().position.x).toBeCloseTo(4, 6);

    rig.setAnimation(null);
    expect(rig.isAnimating()).toBe(false);
    expect(camera().position).toEqual(BASE.position);
  });

  it('leaves the camera alone for a disabled move', () => {
    const { host, camera } = fakeHost(BASE);
    const rig = new CameraRig({ host, bounds: () => BOUNDS });

    rig.setAnimation(move({ enabled: false }));
    expect(rig.isAnimating()).toBe(false);
    expect(rig.advanceAnimation(1000)).toBe(false);
    expect(camera().position).toEqual(BASE.position);
  });

  it('reports the stored placement while the move plays', () => {
    const { host } = fakeHost(BASE);
    const rig = new CameraRig({ host, bounds: () => BOUNDS });
    rig.setAnimation(move());
    rig.advanceAnimation(1000);
    expect(rig.getState()).toEqual(BASE);
  });

  it('restarts the move around a placement the user picks', () => {
    const { host, camera } = fakeHost(BASE);
    const rig = new CameraRig({ host, bounds: () => BOUNDS });
    rig.setAnimation(move());

    rig.setState({ target: { x: 1, y: 0, z: 0 } });
    const radius = distance(camera());
    rig.advanceAnimation(1000);
    expect(camera().target).toEqual({ x: 1, y: 0, z: 0 });
    expect(distance(camera())).toBeCloseTo(radius, 6);
  });
});

describe('normalizeCameraAnimation', () => {
  it('fills a partial config from the defaults', () => {
    expect(normalizeCameraAnimation({ kind: 'pan' })).toEqual({
      kind: 'pan', enabled: false, periodSec: 12, amplitude: 60,
    });
  });

  it('clamps the period and rejects unknown moves', () => {
    expect(normalizeCameraAnimation({ periodSec: 999 }).periodSec).toBe(60);
    expect(normalizeCameraAnimation({ kind: 'zoom' as CameraAnimationConfig['kind'] }).kind).toBe('orbit');
  });
});
