import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelfCollisionSolver } from '../../src/sim/selfCollision';
import { ClothSimulator } from '../../src/sim/clothSimulator';
import type { ClothSimInput } from '../../src/sim/simTypes';
import { FABRIC_PHYSICS_PRESETS, createDefaultProject } from '../../src/core/model/defaults';

// The simulator reads the WebGPU enums while creating resources.
const globals = globalThis as unknown as Record<string, unknown>;
globals.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globals.GPUShaderStage ??= { COMPUTE: 4 };

/** Device stand-in: every buffer records its own destroy, other resources are inert. */
function fakeDevice(): GPUDevice {
  const makeBuffer = () => ({ destroy() {} });
  const resource = {};
  const computePass = {
    setPipeline: () => {},
    setBindGroup: () => {},
    dispatchWorkgroups: () => {},
    end: () => {},
  };
  return {
    createBuffer: makeBuffer,
    createShaderModule: () => resource,
    createBindGroupLayout: () => resource,
    createPipelineLayout: () => resource,
    createComputePipeline: () => resource,
    createBindGroup: () => resource,
    createCommandEncoder: () => ({
      beginComputePass: () => computePass,
      copyBufferToBuffer: () => {},
      finish: () => resource,
    }),
    queue: { writeBuffer: () => {}, submit: () => {}, onSubmittedWorkDone: async () => {} },
  } as unknown as GPUDevice;
}

/** Distance between two flat-xyz particles. */
function distance(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[b * 3]! - positions[a * 3]!,
    positions[b * 3 + 1]! - positions[a * 3 + 1]!,
    positions[b * 3 + 2]! - positions[a * 3 + 2]!,
  );
}

/** Reference implementation: every pair, accumulated, applied once per iteration. */
function bruteForce(
  source: Float32Array,
  invMasses: Float32Array,
  layers: Uint8Array,
  thickness: number,
  layerSpacing: number,
  iterations: number,
): Float32Array {
  const n = invMasses.length;
  const positions = source.slice();
  const delta = new Float32Array(n * 3);
  const cellSize = Math.max(thickness, 0.01);
  let minLayer = 255;
  let maxLayer = 0;
  for (let i = 0; i < n; i++) {
    minLayer = Math.min(minLayer, layers[i]!);
    maxLayer = Math.max(maxLayer, layers[i]!);
  }
  const radius = Math.min(2, Math.max(1, Math.ceil((thickness + (maxLayer - minLayer) * layerSpacing) / cellSize)));
  const reach = radius * cellSize;
  for (let iter = 0; iter < iterations; iter++) {
    delta.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const wSum = invMasses[i]! + invMasses[j]!;
        if (wSum <= 0) continue;
        const ex = positions[j * 3]! - positions[i * 3]!;
        const ey = positions[j * 3 + 1]! - positions[i * 3 + 1]!;
        const ez = positions[j * 3 + 2]! - positions[i * 3 + 2]!;
        const dist = Math.hypot(ex, ey, ez);
        const spacing = Math.min(thickness + Math.abs(layers[i]! - layers[j]!) * layerSpacing, reach);
        if (dist >= spacing) continue;
        const sx = dist > 1e-8 ? ex / dist : 0;
        const sy = dist > 1e-8 ? ey / dist : 1;
        const sz = dist > 1e-8 ? ez / dist : 0;
        const overlap = (spacing - dist) / wSum;
        delta[i * 3] -= sx * overlap * invMasses[i]!;
        delta[i * 3 + 1] -= sy * overlap * invMasses[i]!;
        delta[i * 3 + 2] -= sz * overlap * invMasses[i]!;
        delta[j * 3] += sx * overlap * invMasses[j]!;
        delta[j * 3 + 1] += sy * overlap * invMasses[j]!;
        delta[j * 3 + 2] += sz * overlap * invMasses[j]!;
      }
    }
    for (let i = 0; i < n; i++) {
      positions[i * 3] = positions[i * 3]! + delta[i * 3]!;
      positions[i * 3 + 1] = positions[i * 3 + 1]! + delta[i * 3 + 1]!;
      positions[i * 3 + 2] = positions[i * 3 + 2]! + delta[i * 3 + 2]!;
    }
  }
  return positions;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('self collision projection', () => {
  it('pushes two overlapping particles apart to the cloth thickness', () => {
    const solver = new SelfCollisionSolver(2);
    const positions = new Float32Array([0, 0, 0, 0.001, 0, 0]);
    const result = solver.resolve(positions, new Float32Array([1, 1]), new Uint8Array(2), {
      thickness: 0.002, layerSpacing: 0.004,
    });
    expect(result.moved).toBe(true);
    expect(distance(positions, 0, 1)).toBeCloseTo(0.002, 6);
    // Equal inverse masses share the correction evenly.
    expect(positions[0]).toBeCloseTo(-0.0005, 6);
    expect(positions[3]).toBeCloseTo(0.0015, 6);
  });

  it('leaves a pinned particle in place and moves only the free one', () => {
    const solver = new SelfCollisionSolver(2);
    const positions = new Float32Array([0, 0, 0, 0.001, 0, 0]);
    const result = solver.resolve(positions, new Float32Array([0, 1]), new Uint8Array(2), {
      thickness: 0.002, layerSpacing: 0,
    });
    expect(result.moved).toBe(true);
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(0);
    expect(positions[2]).toBe(0);
    expect(positions[3]).toBeCloseTo(0.002, 6);
  });

  it('separates particles further as the layer difference grows', () => {
    const params = { thickness: 0.002, layerSpacing: 0.004 };
    const sameLayer = new Float32Array([0, 0, 0, 0.001, 0, 0]);
    new SelfCollisionSolver(2).resolve(sameLayer, new Float32Array([1, 1]), new Uint8Array([0, 0]), params);
    expect(distance(sameLayer, 0, 1)).toBeCloseTo(0.002, 6);

    const twoLayers = new Float32Array([0, 0, 0, 0.001, 0, 0]);
    new SelfCollisionSolver(2).resolve(twoLayers, new Float32Array([1, 1]), new Uint8Array([0, 2]), params);
    expect(distance(twoLayers, 0, 1)).toBeCloseTo(0.01, 6);
  });

  it('keeps positions untouched with a zero thickness and no layer spacing', () => {
    const solver = new SelfCollisionSolver(2);
    const positions = new Float32Array([0, 0, 0, 0.0001, 0, 0]);
    const before = positions.slice();
    const result = solver.resolve(positions, new Float32Array([1, 1]), new Uint8Array(2), {
      thickness: 0, layerSpacing: 0,
    });
    expect(result.moved).toBe(false);
    expect(Array.from(positions)).toEqual(Array.from(before));
  });

  it('keeps a non-finite particle as it is', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const solver = new SelfCollisionSolver(2);
    const positions = new Float32Array([Number.NaN, 0, 0, 0.001, 0, 0]);
    const result = solver.resolve(positions, new Float32Array([1, 1]), new Uint8Array(2), {
      thickness: 0.002, layerSpacing: 0.004,
    });
    expect(result.moved).toBe(false);
    expect(Number.isNaN(positions[0])).toBe(true);
    expect(positions[3]).toBeCloseTo(0.001, 7);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('spatial hash against brute force', () => {
  it('matches the all-pairs result on a small set', () => {
    const count = 24;
    const positions = new Float32Array(count * 3);
    const layers = new Uint8Array(count);
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = random() * 0.03;
      positions[i * 3 + 1] = random() * 0.03;
      positions[i * 3 + 2] = random() * 0.03;
      layers[i] = i % 2;
    }
    const invMasses = new Float32Array(count).fill(1);

    const hashed = positions.slice();
    new SelfCollisionSolver(count).resolve(hashed, invMasses, layers, {
      thickness: 0.01, layerSpacing: 0.005, iterations: 2,
    });
    const reference = bruteForce(positions, invMasses, layers, 0.01, 0.005, 2);

    for (let i = 0; i < count * 3; i++) {
      expect(hashed[i]).toBeCloseTo(reference[i]!, 6);
    }
  });
});

/** One panel of two particles one millimeter apart, with no triangles. */
function nearPairInput(): ClothSimInput {
  const positions = new Float32Array([0, 0, 0, 0.001, 0, 0]);
  const mesh = {
    positions: new Float32Array([0, 0, 0.1, 0]),
    indices: new Uint32Array(0),
    vertexCount: 2,
    triangleCount: 0,
  };
  return {
    positions,
    indices: new Uint32Array(0),
    panels: [{
      panelId: 'pair',
      vertexOffset: 0,
      mesh,
      positions3D: positions,
      restPositions: mesh.positions,
      physics: FABRIC_PHYSICS_PRESETS.cotton,
      collisionLayer: 0,
    }],
    seamConstraints: [],
    pinnedIndices: [],
    particleCount: 2,
    triangleCount: 0,
  };
}

describe('self collision switch on the simulator', () => {
  it('leaves the positions alone while self collision is off', async () => {
    const sim = new ClothSimulator(fakeDevice());
    await sim.setup(nearPairInput(), null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { applySelfCollision(): void };

    sim.step({ ...createDefaultProject().scene.simulation, selfCollision: false }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.001, 0, 0]));
    internals.applySelfCollision();
    expect(sim.getReadbackPositions()[3]).toBeCloseTo(0.001, 7);
  });

  it('separates the pair while self collision is on', async () => {
    const sim = new ClothSimulator(fakeDevice());
    await sim.setup(nearPairInput(), null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { applySelfCollision(): void };

    sim.step(createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.001, 0, 0]));
    internals.applySelfCollision();
    expect(distance(sim.getReadbackPositions(), 0, 1)).toBeCloseTo(0.002, 6);
  });
});
