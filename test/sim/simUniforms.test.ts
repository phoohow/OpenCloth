import { describe, expect, it } from 'vitest';
import { packCollideParams, packIntegrateParams } from '@/sim/device';
import { FABRIC_PHYSICS_PRESETS, createDefaultProject } from '@/model/defaults';

function packed(grabForce: readonly [number, number, number, number] | null): Float32Array {
  return packIntegrateParams(
    createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton.damping, 64, 0.5, grabForce,
  );
}

describe('integrate params', () => {
  it('carries the grab force and its flag only while the cloth is pulled', () => {
    const idle = packed(null);
    expect(idle.length).toBe(20);
    expect(Array.from(idle.slice(16))).toEqual([0, 0, 0, 0]);

    const data = packed([0.4, 0.5, 0.6, 1]);
    expect(data[16]).toBeCloseTo(0.4, 5);
    expect(data[17]).toBeCloseTo(0.5, 5);
    expect(data[18]).toBeCloseTo(0.6, 5);
    expect(data[19]).toBe(1);
  });

  it('keeps the fields before the drag block in their packed slots', () => {
    const data = packed([1, 1, 1, 1]);
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
    triangleCount: 1,
    origin: [0, 0, 0] as [number, number, number],
    cell: 0.1,
    dims: [1, 1, 1] as [number, number, number],
  };

  it('packs the collision grid, floor and triangle count', () => {
    const config = createDefaultProject().scene.simulation;
    const data = packCollideParams(config, 32, body, -0.7);
    expect(data.length).toBe(16);
    expect(data[0]).toBeCloseTo(config.dt, 6);
    expect(new Uint32Array(data.buffer)[1]).toBe(32);
    expect(data[4]).toBeCloseTo(-0.7, 6);
    expect(new Uint32Array(data.buffer)[6]).toBe(1);
    expect(data[8]).toBeCloseTo(body.origin[0], 6);
    expect(data[11]).toBeCloseTo(body.cell, 6);
    expect(data[12]).toBeCloseTo(body.dims[0], 6);
  });

  it('drops the body triangles while avatar collision is off', () => {
    const config = { ...createDefaultProject().scene.simulation, avatarCollision: false };
    expect(new Uint32Array(packCollideParams(config, 32, body, 0).buffer)[6]).toBe(0);
  });

  it('keeps the floor flag on unless the switch was turned off', () => {
    const base = createDefaultProject().scene.simulation;
    expect(new Uint32Array(packCollideParams(base, 32, body, 0).buffer)[7]).toBe(1);
    expect(new Uint32Array(packCollideParams({ ...base, floorCollision: false }, 32, body, 0).buffer)[7]).toBe(0);
    expect(new Uint32Array(packCollideParams({ ...base, floorCollision: undefined }, 32, body, 0).buffer)[7]).toBe(1);
  });

  it('scales the per-particle friction by the config, defaulting to full strength', () => {
    const base = createDefaultProject().scene.simulation;
    expect(packCollideParams(base, 32, body, 0)[3]).toBe(1);
    expect(packCollideParams({ ...base, contactFrictionScale: 0 }, 32, body, 0)[3]).toBe(0);
    expect(packCollideParams({ ...base, contactFrictionScale: 0.25 }, 32, body, 0)[3]).toBeCloseTo(0.25, 6);
  });
});
