import { describe, expect, it } from 'vitest';
import { ClothSimulator } from '../../src/sim/clothSimulator';
import type { ClothSimInput } from '../../src/sim/simTypes';
import type { Constraint } from '../../src/sim/buffers/constraintBuilder';
import type { FabricPhysics } from '../../src/core/model/types';
import { FABRIC_PHYSICS_PRESETS, createDefaultProject } from '../../src/core/model/defaults';

// The simulator reads the WebGPU enums while creating resources.
const globals = globalThis as unknown as Record<string, unknown>;
globals.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globals.GPUShaderStage ??= { COMPUTE: 4 };

/** Device stand-in: every buffer records its own destroy, other resources are inert. */
function fakeDevice(): { device: GPUDevice; submits: () => number; destroyedBuffers: () => number } {
  let destroyed = 0;
  let submitted = 0;
  const makeBuffer = () => ({ destroy() { destroyed++; } });
  const resource = {};
  const computePass = {
    setPipeline: () => {},
    setBindGroup: () => {},
    dispatchWorkgroups: () => {},
    end: () => {},
  };
  const device = {
    createBuffer: makeBuffer,
    createShaderModule: () => resource,
    createBindGroupLayout: () => resource,
    createPipelineLayout: () => resource,
    createComputePipeline: () => resource,
    createBindGroup: () => resource,
    createCommandEncoder: () => ({ beginComputePass: () => computePass, finish: () => resource }),
    queue: {
      writeBuffer: () => {},
      submit: () => { submitted++; },
      onSubmittedWorkDone: async () => {},
    },
  } as unknown as GPUDevice;
  return { device, submits: () => submitted, destroyedBuffers: () => destroyed };
}

/** Four particles along +X; particle 2 sits closest to the pick ray. */
function makeInput(options: { creaseEdges?: number[]; seamConstraints?: Constraint[] } = {}): ClothSimInput {
  const positions = new Float32Array([
    0.1, 0.01, 0,
    0.3, 0.02, 0,
    0.5, 0.005, 0,
    0.7, 0.02, 0,
  ]);
  const mesh = {
    positions: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
    vertexCount: 4,
    triangleCount: 2,
  };
  return {
    positions,
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
    panels: [{
      panelId: 'front',
      vertexOffset: 0,
      mesh,
      positions3D: positions,
      restPositions: mesh.positions,
      physics: FABRIC_PHYSICS_PRESETS.cotton,
      ...(options.creaseEdges ? { creaseEdges: options.creaseEdges } : {}),
    }],
    seamConstraints: options.seamConstraints ?? [],
    pinnedIndices: [],
    particleCount: 4,
    triangleCount: 2,
  };
}

/** Simulator running on the fake device, with a count of the work it submitted. */
async function setupSimulator(input: ClothSimInput): Promise<{ sim: ClothSimulator; submits: () => number }> {
  const { device, submits } = fakeDevice();
  const sim = new ClothSimulator(device);
  await sim.setup(input, null, createDefaultProject().scene.simulation);
  return { sim, submits };
}

const RAY_ORIGIN = { x: 0, y: 0, z: 0 };
const RAY_DIR = { x: 1, y: 0, z: 0 };

describe('cloth simulator position cache', () => {
  it('picks particles before the first GPU readback', async () => {
    const { sim } = await setupSimulator(makeInput());
    const hit = sim.pickNearestParticle(RAY_ORIGIN, RAY_DIR, 0.03);
    expect(hit?.index).toBe(2);
  });

  it('follows a reset to new initial positions', async () => {
    const { sim } = await setupSimulator(makeInput());
    sim.reset(new Float32Array([
      0.1, 0.01, 0,
      0.3, 0.005, 0,
      0.5, 0.02, 0,
      0.7, 0.02, 0,
    ]));
    expect(sim.pickNearestParticle(RAY_ORIGIN, RAY_DIR, 0.03)?.index).toBe(1);
  });

  it('picks the particle closest to a surface point on one panel', async () => {
    const { sim } = await setupSimulator(makeInput());
    const hit = sim.pickNearestAtPoint({ x: 0.51, y: 0.005, z: 0 }, 0.03, 0);
    expect(hit?.index).toBe(2);
    // The same search without a panel filter still finds the closest particle overall.
    expect(sim.pickNearestAtPoint({ x: 0.29, y: 0, z: 0 }, 0.03, -1)?.index).toBe(1);
  });

  it('reports pins as set and rejects out-of-range indices', async () => {
    const { sim } = await setupSimulator(makeInput());
    expect(await sim.setParticlePin(2, true)).toBe(true);
    expect(sim.getPinnedParticles()).toEqual([2]);
    expect(await sim.setParticlePin(4, true)).toBe(false);
    expect(await sim.setParticlePin(2, false)).toBe(true);
    expect(sim.getPinnedParticles()).toEqual([]);
  });
});

describe('batched pin changes', () => {
  it('pins a whole list in one submitted pass', async () => {
    const { sim, submits } = await setupSimulator(makeInput());
    const before = submits();
    expect(await sim.setParticlePins([0, 1, 2, 3], true)).toBe(true);
    expect(submits() - before).toBe(1);
    expect(sim.getPinnedParticles()).toEqual([0, 1, 2, 3]);

    const unpinStart = submits();
    expect(await sim.setParticlePins([0, 1, 2, 3], false)).toBe(true);
    expect(submits() - unpinStart).toBe(1);
    expect(sim.getPinnedParticles()).toEqual([]);
  });

  it('leaves the pin set untouched when one index is bad', async () => {
    const { sim, submits } = await setupSimulator(makeInput());
    const before = submits();
    expect(await sim.setParticlePins([0, 1, 9], true)).toBe(false);
    expect(sim.getPinnedParticles()).toEqual([]);
    expect(submits()).toBe(before);
  });

  it('keeps pinned particles out of the restored inverse masses', async () => {
    const { sim } = await setupSimulator(makeInput());
    expect(await sim.setParticlePins([1, 3], true)).toBe(true);
    sim.reset(new Float32Array(12));
    expect(sim.getPinnedParticles()).toEqual([1, 3]);
  });
});

/** Constraint group view of the solver internals. */
interface GroupView {
  groups: Map<string, { batched: { count: number; batches: Constraint[][] } }>;
  particleCount: number;
}

/** Live constraints of one solver constraint group. */
function constraintsOf(sim: ClothSimulator, kind: string): Constraint[] {
  return (sim as unknown as GroupView).groups.get(kind)?.batched.batches.flat() ?? [];
}

describe('fold crease constraint group', () => {
  it('holds the creases a panel fold line produces', async () => {
    const { sim } = await setupSimulator(makeInput({ creaseEdges: [1, 2] }));
    const crease = constraintsOf(sim, 'crease');
    expect(crease).toHaveLength(1);
    expect([crease[0]!.p0, crease[0]!.p1].sort((a, b) => a - b)).toEqual([0, 3]);
  });

  it('toggles creases off and on without touching the particle layout', async () => {
    const { sim, submits } = await setupSimulator(makeInput({ creaseEdges: [1, 2] }));
    const submitted = submits();
    const internals = sim as unknown as GroupView;

    expect(sim.setCreaseEdges([[]])).toBe(true);
    expect(constraintsOf(sim, 'crease')).toHaveLength(0);
    expect(sim.setCreaseEdges([[1, 2]])).toBe(true);
    expect(constraintsOf(sim, 'crease')).toHaveLength(1);
    expect(internals.particleCount).toBe(4);
    // Crease edits only upload constraints; they never submit a simulation frame.
    expect(submits()).toBe(submitted);
    // A panel slot count that no longer matches is rejected rather than guessed at.
    expect(sim.setCreaseEdges([[], []])).toBe(false);
  });

  it('applies a crease stiffness change without rebuilding the solver', async () => {
    const { sim, submits } = await setupSimulator(makeInput({ creaseEdges: [1, 2] }));
    const submitted = submits();
    const before = constraintsOf(sim, 'crease')[0]!.compliance;

    const softened: FabricPhysics = { ...FABRIC_PHYSICS_PRESETS.cotton, creaseStiffness: 0.55 };
    expect(sim.updateMaterialPhysics([softened], new Float32Array(12))).toBe(true);
    expect(constraintsOf(sim, 'crease')[0]!.compliance).toBeGreaterThan(before);
    expect(submits()).toBe(submitted);
    expect((sim as unknown as GroupView).particleCount).toBe(4);

    // An identical call leaves the group alone.
    expect(sim.updateMaterialPhysics([softened], new Float32Array(12))).toBe(true);
    expect(submits()).toBe(submitted);
  });
});

describe('live seam constraint sets', () => {
  const seam = (p0: number, p1: number, restLength: number): Constraint =>
    ({ p0, p1, restLength, compliance: 1e-4 });

  it('replaces the seam group when a dart closes', async () => {
    const { sim } = await setupSimulator(makeInput({ seamConstraints: [seam(0, 3, 0.4)] }));
    expect(await sim.setParticlePin(1, true)).toBe(true);

    // A closing dart adds leg pairs whose rest length already pulls the legs together.
    sim.setSeamConstraints([seam(0, 3, 0.4), seam(1, 2, 0), seam(2, 1, 0)]);
    expect(constraintsOf(sim, 'seam')).toHaveLength(3);
    expect(sim.getPinnedParticles()).toEqual([1]);

    sim.setSeamConstraints([]);
    expect(constraintsOf(sim, 'seam')).toHaveLength(0);
  });

  it('reopens seams on reset while a closed dart stays stitched', async () => {
    const { sim } = await setupSimulator(makeInput({ seamConstraints: [seam(0, 3, 0.4)] }));
    sim.setSeamConstraints([seam(0, 3, 0.4), seam(1, 2, 0)]);
    sim.reset(new Float32Array(12));
    expect(constraintsOf(sim, 'seam').map(c => c.restLength)).toEqual([0.4, 0]);
    sim.setSeamProgress(1);
    expect(constraintsOf(sim, 'seam').map(c => c.restLength)).toEqual([0, 0]);
  });
});

describe('simulator teardown', () => {  it('destroy releases every buffer and stops the solver', async () => {
    const { device, destroyedBuffers } = fakeDevice();
    const sim = new ClothSimulator(device);
    await sim.setup(makeInput(), null, createDefaultProject().scene.simulation);
    sim.destroy();
    const released = destroyedBuffers();
    expect(released).toBeGreaterThan(20);

    // Destroyed simulators step nothing and serve the CPU cache.
    sim.step(createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton);
    const { positions } = await sim.readback();
    expect(positions.length).toBe(makeInput().particleCount * 3);
    sim.destroy();
    expect(destroyedBuffers()).toBe(released);
  });
});
