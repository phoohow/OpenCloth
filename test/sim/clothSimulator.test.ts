import { describe, expect, it } from 'vitest';
import { createClothSimulator, type ClothSimulator } from '@/sim/solver';
import type { ClothSimInput } from '@/sim/common';
import type { Constraint } from '@/sim/common';
import type { FabricPhysics } from '@/model/types';
import { FABRIC_PHYSICS_PRESETS, createDefaultProject } from '@/model/defaults';

const globals = globalThis as unknown as Record<string, unknown>;
globals.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globals.GPUShaderStage ??= { COMPUTE: 4 };
globals.GPUMapMode ??= { READ: 1 };

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
    seams: options.seamConstraints ?? [],
    pinnedIndices: [],
    particleCount: 4,
    triangleCount: 2,
  };
}

function taggingDevice(): { device: GPUDevice; submits: () => number } {
  let submitted = 0;
  const makeBuffer = (options: { size: number }) => {
    const bytes = new Float32Array(Math.max(4, options.size) / 4);
    let tag = -1;
    return {
      destroy: () => {},
      mapAsync: async () => { bytes.fill(tag); },
      getMappedRange: () => bytes.buffer,
      unmap: () => {},
      setTag: (value: number) => { tag = value; },
    };
  };
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
    createCommandEncoder: () => ({
      beginComputePass: () => computePass,
      copyBufferToBuffer: (_src: unknown, _srcOffset: number, dst: { setTag: (v: number) => void }) => {
        if (dst.setTag) dst.setTag(submitted);
      },
      finish: () => resource,
    }),
    queue: {
      writeBuffer: () => {},
      submit: () => { submitted++; },
      onSubmittedWorkDone: async () => {},
    },
  } as unknown as GPUDevice;
  return { device, submits: () => submitted };
}

async function setupSimulator(input: ClothSimInput): Promise<{ sim: ClothSimulator; submits: () => number }> {
  const { device, submits } = fakeDevice();
  const sim = createClothSimulator({ device: () => device });
  await sim.setup(input, null, createDefaultProject().scene.simulation);
  return { sim, submits };
}

const RAY_ORIGIN = { x: 0, y: 0, z: 0 };
const RAY_DIR = { x: 1, y: 0, z: 0 };

describe('cloth simulator position cache', () => {
  it('picks particles before the first GPU readback', async () => {
    const { sim } = await setupSimulator(makeInput());
    const hit = sim.pickRay(RAY_ORIGIN, RAY_DIR, 0.03);
    expect(hit?.index).toBe(2);
  });

  it('writes live positions into the merged input array', async () => {
    const input = makeInput();
    const { sim } = await setupSimulator(input);
    expect(sim.positions).toBe(input.positions);
    sim.setPositions(new Float32Array([
      0.2, 0.3, 0.4,
      0.5, 0.6, 0.7,
      0.8, 0.9, 1.0,
      1.1, 1.2, 1.3,
    ]));
    expect(input.positions[0]).toBeCloseTo(0.2);
    expect(input.positions[1]).toBeCloseTo(0.3);
    expect(input.positions[11]).toBeCloseTo(1.3);
  });

  it('follows a rebase onto a new input array', async () => {
    const { sim } = await setupSimulator(makeInput());
    const rebased = makeInput();
    const live = new Float32Array([
      2.0, 0, 0,
      2.2, 0, 0,
      2.4, 0, 0,
      2.6, 0, 0,
    ]);
    expect(sim.apply({ kind: 'geometry', input: rebased, initial: rebased.positions })).toBe(true);
    sim.setPositions(live);

    expect(sim.positions).toBe(rebased.positions);
    expect(rebased.positions[0]).toBeCloseTo(2.0);
    expect(rebased.positions[9]).toBeCloseTo(2.6);
  });

  it('follows a reset to new initial positions', async () => {
    const { sim } = await setupSimulator(makeInput());
    sim.reset(new Float32Array([
      0.1, 0.01, 0,
      0.3, 0.005, 0,
      0.5, 0.02, 0,
      0.7, 0.02, 0,
    ]));
    expect(sim.pickRay(RAY_ORIGIN, RAY_DIR, 0.03)?.index).toBe(1);
  });

  it('picks the particle closest to a surface point on one panel', async () => {
    const { sim } = await setupSimulator(makeInput());
    const hit = sim.pickPoint({ x: 0.51, y: 0.005, z: 0 }, 0.03, 0);
    expect(hit?.index).toBe(2);
    expect(sim.pickPoint({ x: 0.29, y: 0, z: 0 }, 0.03, -1)?.index).toBe(1);
  });

  it('reports pins as set and rejects out-of-range indices', async () => {
    const { sim } = await setupSimulator(makeInput());
    expect(await sim.pin([2], true)).toBe(true);
    expect(sim.pinned()).toEqual([2]);
    expect(await sim.pin([4], true)).toBe(false);
    expect(await sim.pin([2], false)).toBe(true);
    expect(sim.pinned()).toEqual([]);
  });
});

describe('batched pin changes', () => {
  it('pins a whole list in one submitted pass', async () => {
    const { sim, submits } = await setupSimulator(makeInput());
    const before = submits();
    expect(await sim.pin([0, 1, 2, 3], true)).toBe(true);
    expect(submits() - before).toBe(1);
    expect(sim.pinned()).toEqual([0, 1, 2, 3]);

    const unpinStart = submits();
    expect(await sim.pin([0, 1, 2, 3], false)).toBe(true);
    expect(submits() - unpinStart).toBe(1);
    expect(sim.pinned()).toEqual([]);
  });

  it('leaves the pin set untouched when one index is bad', async () => {
    const { sim, submits } = await setupSimulator(makeInput());
    const before = submits();
    expect(await sim.pin([0, 1, 9], true)).toBe(false);
    expect(sim.pinned()).toEqual([]);
    expect(submits()).toBe(before);
  });

  it('keeps pinned particles out of the restored inverse masses', async () => {
    const { sim } = await setupSimulator(makeInput());
    expect(await sim.pin([1, 3], true)).toBe(true);
    sim.reset(new Float32Array(12));
    expect(sim.pinned()).toEqual([1, 3]);
  });

  it('restores the inverse mass of the pins the layout was set up with', async () => {
    const { sim } = await setupSimulator({ ...makeInput(), pinnedIndices: [2] });
    const masses = (sim as unknown as RestoreView).rebuild.initialInverseMass;
    expect(masses[2]).toBe(0);
    expect(masses[0]).toBeGreaterThan(0);
  });
});

interface RestoreView {
  rebuild: { initialInverseMass: Float32Array };
}

interface GroupView {
  resources: {
    groups: Map<string, { batched: { count: number; batches: Constraint[][] } }>;
    particleCount: number;
  };
}

function constraintsOf(sim: ClothSimulator, kind: string): Constraint[] {
  return (sim as unknown as GroupView).resources.groups.get(kind)?.batched.batches.flat() ?? [];
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
    const internals = (sim as unknown as GroupView).resources;

    expect(sim.apply({ kind: 'constraints', seams: [], creases: [[]] })).toBe(true);
    expect(constraintsOf(sim, 'crease')).toHaveLength(0);
    expect(sim.apply({ kind: 'constraints', seams: [], creases: [[1, 2]] })).toBe(true);
    expect(constraintsOf(sim, 'crease')).toHaveLength(1);
    expect(internals.particleCount).toBe(4);
    expect(submits()).toBe(submitted);
    expect(sim.apply({ kind: 'constraints', seams: [], creases: [[], []] })).toBe(false);
  });

  it('applies a crease stiffness change without rebuilding the solver', async () => {
    const { sim, submits } = await setupSimulator(makeInput({ creaseEdges: [1, 2] }));
    const submitted = submits();
    const before = constraintsOf(sim, 'crease')[0]!.compliance;

    const softened: FabricPhysics = { ...FABRIC_PHYSICS_PRESETS.cotton, creaseStiffness: 0.55 };
    expect(sim.apply({ kind: 'materials', physics: [softened] })).toBe(true);
    expect(constraintsOf(sim, 'crease')[0]!.compliance).toBeGreaterThan(before);
    expect(submits()).toBe(submitted);
    expect((sim as unknown as GroupView).resources.particleCount).toBe(4);

    expect(sim.apply({ kind: 'materials', physics: [softened] })).toBe(true);
    expect(submits()).toBe(submitted);
  });

  it('keeps the creases a constraint update installed away from the input', async () => {
    const input = makeInput();
    const { sim } = await setupSimulator(input);
    expect(sim.apply({ kind: 'constraints', seams: [], creases: [[1, 2]] })).toBe(true);
    expect(constraintsOf(sim, 'crease')).toHaveLength(1);
    expect(input.panels[0]!.creaseEdges).toBeUndefined();

    const softened: FabricPhysics = { ...FABRIC_PHYSICS_PRESETS.cotton, creaseStiffness: 0.55 };
    expect(sim.apply({ kind: 'materials', physics: [softened] })).toBe(true);
    expect(constraintsOf(sim, 'crease')).toHaveLength(1);
  });
});

describe('live seam constraint sets', () => {
  const seam = (p0: number, p1: number, restLength: number): Constraint =>
    ({ p0, p1, restLength, compliance: 1e-4 });

  it('replaces the seam group when a dart closes', async () => {
    const { sim } = await setupSimulator(makeInput({ seamConstraints: [seam(0, 3, 0.4)] }));
    expect(await sim.pin([1], true)).toBe(true);

    sim.apply({ kind: 'constraints', seams: [seam(0, 3, 0.4), seam(1, 2, 0), seam(2, 1, 0)], creases: [[]] });
    expect(constraintsOf(sim, 'seam')).toHaveLength(3);
    expect(sim.pinned()).toEqual([1]);

    sim.apply({ kind: 'constraints', seams: [], creases: [[]] });
    expect(constraintsOf(sim, 'seam')).toHaveLength(0);
  });

  it('reopens seams on reset while a closed dart stays stitched', async () => {
    const { sim } = await setupSimulator(makeInput({ seamConstraints: [seam(0, 3, 0.4)] }));
    sim.apply({ kind: 'constraints', seams: [seam(0, 3, 0.4), seam(1, 2, 0)], creases: [[]] });
    sim.reset(new Float32Array(12));
    expect(constraintsOf(sim, 'seam').map(c => c.restLength)).toEqual([0.4, 0]);
    sim.setSeamProgress(1);
    expect(constraintsOf(sim, 'seam').map(c => c.restLength)).toEqual([0, 0]);
  });

  it('keeps a dressed garment closed when its seam group is replaced', async () => {
    const { sim } = await setupSimulator(makeInput({ seamConstraints: [seam(0, 3, 0.4)] }));
    sim.setSeamProgress(1);
    expect(constraintsOf(sim, 'seam').map(c => c.restLength)).toEqual([0]);

    sim.apply({ kind: 'constraints', seams: [seam(0, 3, 0.4), seam(1, 2, 0)], creases: [[]] });
    expect(constraintsOf(sim, 'seam').map(c => c.restLength)).toEqual([0, 0]);
  });
});

describe('readback pipeline', () => {
  const config = createDefaultProject().scene.simulation;
  const fabric = FABRIC_PHYSICS_PRESETS.cotton;

  it('draws the frame of the previous step and leaves the newest copy in flight', async () => {
    const device = taggingDevice();
    const sim = createClothSimulator({ device: () => device.device });
    await sim.setup(makeInput(), null, config);

    sim.step(config, fabric);
    const firstTag = device.submits() - 1;
    expect(await sim.readback()).toBeNull();

    sim.step(config, fabric);
    const secondTag = device.submits() - 1;
    expect((await sim.readback())?.positions[0]).toBe(firstTag);

    sim.step(config, fabric);
    expect((await sim.readback())?.positions[0]).toBe(secondTag);
  });

  it('serves the frame just stepped to a caller that drives the solver itself', async () => {
    const device = taggingDevice();
    const sim = createClothSimulator({ device: () => device.device });
    await sim.setup(makeInput(), null, config);

    sim.step(config, fabric);
    expect((await sim.readbackLatest()).positions[0]).toBe(device.submits() - 1);
  });

  it('drops the copies of the layout a reset abandoned', async () => {
    const device = taggingDevice();
    const sim = createClothSimulator({ device: () => device.device });
    await sim.setup(makeInput(), null, config);

    sim.step(config, fabric);
    sim.step(config, fabric);
    sim.reset(makeInput().positions);
    expect(await sim.readback()).toBeNull();
  });
});

describe('simulator teardown', () => {  it('destroy releases every buffer and stops the solver', async () => {
    const { device, destroyedBuffers } = fakeDevice();
    const sim = createClothSimulator({ device: () => device });
    await sim.setup(makeInput(), null, createDefaultProject().scene.simulation);
    sim.destroy();
    const released = destroyedBuffers();
    expect(released).toBeGreaterThan(20);

    sim.step(createDefaultProject().scene.simulation, FABRIC_PHYSICS_PRESETS.cotton);
    const { positions } = await sim.readbackLatest();
    expect(positions.length).toBe(makeInput().particleCount * 3);
    sim.destroy();
    expect(destroyedBuffers()).toBe(released);
  });
});
