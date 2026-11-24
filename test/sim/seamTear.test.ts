import { describe, expect, it } from 'vitest';
import { tornSeamPairs } from '@/sim/particles';
import { seamBreakStretch } from '@/sim/common';
import { createClothSimulator } from '@/sim/solver';
import type { ClothSimInput } from '@/sim/common';
import type { Constraint } from '@/sim/common';
import { FABRIC_PHYSICS_PRESETS, createDefaultProject } from '@/model/defaults';

const globals = globalThis as unknown as Record<string, unknown>;
globals.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globals.GPUShaderStage ??= { COMPUTE: 4 };

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
      seams: [seam],
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
    const sim = createClothSimulator({ device: () => fakeDevice() });
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { resolveSeams(): void };

    sim.step({ ...createDefaultProject().scene.simulation, seamTearing: true }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.01, 0, 0]));
    internals.resolveSeams();

    expect(seam.restLength).toBeCloseTo(0.01, 6);
  });

  it('leaves an intact seam alone', async () => {
    const { input, seam } = tearingInput();
    const sim = createClothSimulator({ device: () => fakeDevice() });
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { resolveSeams(): void };

    sim.step({ ...createDefaultProject().scene.simulation, seamTearing: true }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.001, 0, 0]));
    internals.resolveSeams();

    expect(seam.restLength).toBe(0);
  });

  it('skips the pass while seam tearing is off', async () => {
    const { input, seam } = tearingInput();
    const sim = createClothSimulator({ device: () => fakeDevice() });
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as { resolveSeams(): void };

    sim.step(createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.01, 0, 0]));
    internals.resolveSeams();

    expect(seam.restLength).toBe(0);
  });

  it('drops a torn stitch from the self-collision partner table', async () => {
    const { input, seam } = tearingInput();
    const sim = createClothSimulator({ device: () => fakeDevice() });
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as TearView;
    const tables: number[][] = [];
    internals.selfCollision!.setStitchPairs = pairs => tables.push(pairs.map(pair => pair.p0));

    sim.step({ ...createDefaultProject().scene.simulation, seamTearing: true }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.01, 0, 0]));
    internals.resolveSeams();

    expect(seam.restLength).toBeCloseTo(0.01, 6);
    expect(internals.interaction.liveSeams()).toHaveLength(0);
    expect(tables.at(-1)).toEqual([]);
  });

  it('re-stitches torn seams when the simulation resets', async () => {
    const { input, seam } = tearingInput();
    const sim = createClothSimulator({ device: () => fakeDevice() });
    await sim.setup(input, null, createDefaultProject().scene.simulation);
    const internals = sim as unknown as TearView;

    sim.step({ ...createDefaultProject().scene.simulation, seamTearing: true }, FABRIC_PHYSICS_PRESETS.cotton);
    sim.setPositions(new Float32Array([0, 0, 0, 0.01, 0, 0]));
    internals.resolveSeams();
    expect(internals.interaction.liveSeams()).toHaveLength(0);

    sim.reset(new Float32Array([0, 0, 0, 0, 0, 0]));
    expect(seam.restLength).toBe(0);
    expect(internals.interaction.liveSeams()).toHaveLength(1);
  });
});

interface TearView {
  resolveSeams(): void;
  interaction: { liveSeams(): readonly Constraint[] };
  selfCollision: { setStitchPairs(pairs: readonly { p0: number; p1: number }[]): void } | null;
}
