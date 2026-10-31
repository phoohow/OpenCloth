import { describe, expect, it } from 'vitest';
import { seamBreakStretch, tornSeamPairs } from '../../src/sim/seamStrength';
import { ClothSimulator } from '../../src/sim/clothSimulator';
import type { ClothSimInput } from '../../src/sim/simTypes';
import type { Constraint } from '../../src/sim/buffers/constraintBuilder';
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

describe('seamBreakStretch', () => {
  it('lets a stronger seam stretch further before tearing', () => {
    expect(seamBreakStretch(0.05)).toBeLessThan(seamBreakStretch(1));
    expect(seamBreakStretch(1)).toBeGreaterThan(1);
  });

  it('clamps strength into the tie range', () => {
    expect(seamBreakStretch(0)).toBeCloseTo(seamBreakStretch(0.01), 6);
    expect(seamBreakStretch(5)).toBeCloseTo(seamBreakStretch(1), 6);
  });
});

describe('tornSeamPairs', () => {
  it('returns pairs whose current separation exceeds their tear length', () => {
    const positions = new Float32Array([0, 0, 0, 0.01, 0, 0]);
    const torn = tornSeamPairs(positions, [{ p0: 0, p1: 1, tearLength: 0.005 }]);
    expect(torn.has(0)).toBe(true);
  });

  it('keeps shorter pairs intact', () => {
    const positions = new Float32Array([0, 0, 0, 0.001, 0, 0]);
    const torn = tornSeamPairs(positions, [{ p0: 0, p1: 1, tearLength: 0.005 }]);
    expect(torn.size).toBe(0);
  });

  it('never tears a pair with a non-positive tear length', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const torn = tornSeamPairs(positions, [{ p0: 0, p1: 1, tearLength: 0 }]);
    expect(torn.size).toBe(0);
  });
});

/** Two particles at the origin, joined by one seam constraint that tears at 5 mm. */
function tearingInput(): { input: ClothSimInput; seam: Constraint } {
  const seam: Constraint = { p0: 0, p1: 1, restLength: 0, compliance: 1, tearLength: 0.005 };
  const positions = new Float32Array([0, 0, 0, 0, 0, 0]);
  const mesh = {
    positions: new Float32Array([0, 0, 0.001, 0]),
    indices: new Uint32Array(0),
    vertexCount: 2,
    triangleCount: 0,
  };
  return {
    input: {
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
      seamConstraints: [seam],
      pinnedIndices: [],
      particleCount: 2,
      triangleCount: 0,
    },
    seam,
  };
}

describe('seam tear on the simulator', () => {
  it('neutralizes a seam stretched past its tear length', async () => {
    const { input, seam } = tearingInput();
    const sim = new ClothSimulator(fakeDevice());
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { resolveSeamTears(): void };

    sim.step({ ...createDefaultProject().scene.simulation, seamTearing: true }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.01, 0, 0])); // 10 mm apart, over the 5 mm limit
    internals.resolveSeamTears();

    expect(seam.restLength).toBeCloseTo(0.01, 6);
  });

  it('leaves an intact seam alone', async () => {
    const { input, seam } = tearingInput();
    const sim = new ClothSimulator(fakeDevice());
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { resolveSeamTears(): void };

    sim.step({ ...createDefaultProject().scene.simulation, seamTearing: true }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.001, 0, 0])); // under the tear limit
    internals.resolveSeamTears();

    expect(seam.restLength).toBe(0);
  });

  it('skips the pass while seam tearing is off', async () => {
    const { input, seam } = tearingInput();
    const sim = new ClothSimulator(fakeDevice());
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { resolveSeamTears(): void };

    sim.step(createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.01, 0, 0]));
    internals.resolveSeamTears();

    expect(seam.restLength).toBe(0);
  });
});