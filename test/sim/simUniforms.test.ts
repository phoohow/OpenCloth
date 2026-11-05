import { describe, expect, it } from 'vitest';
import { packCollideParams, packIntegrateParams } from '../../src/sim/simUniforms';
import { FABRIC_PHYSICS_PRESETS, createDefaultProject } from '../../src/core/model/defaults';

/** Uniforms of one integrate dispatch over 64 particles. */
function packed(grabTarget: readonly [number, number, number] | null): Float32Array {
  return packIntegrateParams(
    createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton, 64, 0.5, grabTarget,
  );
}

describe('integrate params', () => {
  it('carries the drag target only while the cloth is being pulled', () => {
    const idle = packed(null);
    expect(idle.length).toBe(20);
    expect(Array.from(idle.slice(16))).toEqual([0, 0, 0, 0]);

    const data = packed([0.4, 0.5, 0.6]);
    expect(data[16]).toBeCloseTo(0.4, 5);
    expect(data[17]).toBeCloseTo(0.5, 5);
    expect(data[18]).toBeCloseTo(0.6, 5);
    expect(data[19]).toBe(1);
  });

  it('keeps the fields before the drag block in their packed slots', () => {
    const data = packed([1, 1, 1]);
    const config = createDefaultProject().scene.simulation;
    expect(data[0]).toBeCloseTo(config.dt, 6);
    expect(new Uint32Array(data.buffer)[1]).toBe(64);
    expect(data[4]).toBeCloseTo(config.gravity.x, 6);
    expect(data[11]).toBeCloseTo(config.wind.speed, 6);
    expect(data[12]).toBeCloseTo(FABRIC_PHYSICS_PRESETS.cotton.damping, 6);
    expect(data[13]).toBeCloseTo(0.5, 6);
  });
});

describe('collide params', () => {
  const body = {
    capsuleCount: 0,
    triangleCount: 1,
    gridOrigin: [0, 0, 0] as [number, number, number],
    gridCell: 0.1,
    gridDims: [1, 1, 1] as [number, number, number],
  };

  it('writes the fabric contact friction and clamps it to 0..1', () => {
    const config = createDefaultProject().scene.simulation;
    expect(packCollideParams(config, 32, body, 0, 0.7)[4]).toBeCloseTo(0.7, 6);
    expect(packCollideParams(config, 32, body, 0, -1)[4]).toBe(0);
    expect(packCollideParams(config, 32, body, 0, 2)[4]).toBe(1);
  });

  it('falls back to the default friction when the value is missing', () => {
    const config = createDefaultProject().scene.simulation;
    expect(packCollideParams(config, 32, body, 0)[4]).toBeCloseTo(0.5, 6);
  });
});
