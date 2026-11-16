import {
  INTEGRATE_WGSL, SOLVE_WGSL, COLLIDE_WGSL, UPDATE_WGSL, NORMALS_WGSL, SET_PIN_WGSL,
  SELF_COLLISION_GRID_WGSL, SELF_COLLISION_SOLVE_WGSL,
} from '@/sim/shaders/shaders';

/** Compute-visible buffer entry kinds, in binding order. */
type BufferAccess = 'storage' | 'read-only-storage' | 'uniform';

/** Bind group layouts shared by the passes; `particleCount` serves the clear and normalize passes. */
export interface SimLayouts {
  integrate: GPUBindGroupLayout;
  solve: GPUBindGroupLayout;
  collide: GPUBindGroupLayout;
  update: GPUBindGroupLayout;
  normals: GPUBindGroupLayout;
  setPin: GPUBindGroupLayout;
  selfGrid: GPUBindGroupLayout;
  selfSolve: GPUBindGroupLayout;
}

/** One compute pipeline per simulation pass, plus the layouts their bind groups use. */
export interface SimPipelines {
  integrate: GPUComputePipeline;
  solve: GPUComputePipeline;
  collide: GPUComputePipeline;
  update: GPUComputePipeline;
  normals: GPUComputePipeline;
  setPin: GPUComputePipeline;
  selfClear: GPUComputePipeline;
  selfFill: GPUComputePipeline;
  selfProject: GPUComputePipeline;
  selfApply: GPUComputePipeline;
  layouts: SimLayouts;
}

/** Bind group layout with one buffer entry per listed access kind, numbered from binding 0. */
function createLayout(device: GPUDevice, accesses: BufferAccess[]): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: accesses.map((type, binding): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
}

/** Creates every compute pipeline and bind group layout from the simulation's WGSL sources. */
export function createSimPipelines(device: GPUDevice): SimPipelines {
  const makeModule = (code: string) => device.createShaderModule({ code });

  const integrateModule = makeModule(INTEGRATE_WGSL);
  const solveModule = makeModule(SOLVE_WGSL);
  const collideModule = makeModule(COLLIDE_WGSL);
  const updateModule = makeModule(UPDATE_WGSL);
  const normalsModule = makeModule(NORMALS_WGSL);
  const selfGridModule = makeModule(SELF_COLLISION_GRID_WGSL);
  const selfSolveModule = makeModule(SELF_COLLISION_SOLVE_WGSL);

  const layoutIntegrate = createLayout(device, [
    'storage', 'storage', 'storage', 'storage', 'uniform', 'read-only-storage',
  ]);
  const layoutSolve = createLayout(device, ['storage', 'read-only-storage', 'read-only-storage', 'uniform']);
  const layoutCollide = createLayout(device, [
    'storage', 'uniform', 'read-only-storage', 'read-only-storage',
    'read-only-storage', 'read-only-storage', 'storage', 'read-only-storage', 'read-only-storage',
  ]);
  const layoutUpdate = createLayout(device, ['storage', 'read-only-storage', 'storage', 'storage', 'uniform', 'read-only-storage']);
  const layoutNormals = createLayout(device, [
    'read-only-storage', 'storage', 'read-only-storage', 'read-only-storage',
    'read-only-storage', 'read-only-storage', 'uniform',
  ]);
  const layoutSetPin = createLayout(device, ['storage', 'read-only-storage', 'uniform', 'read-only-storage']);
  const layoutSelfGrid = createLayout(device, ['uniform', 'read-only-storage', 'storage', 'storage']);
  // Nine entries: the shared params block and the eight buffers a projection reads or writes.
  const layoutSelfSolve = createLayout(device, [
    'uniform', 'storage', 'read-only-storage', 'read-only-storage', 'read-only-storage',
    'read-only-storage', 'read-only-storage', 'read-only-storage', 'storage',
  ]);

  const createPipeline = (module: GPUShaderModule, entryPoint: string, layout: GPUBindGroupLayout) =>
    device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    });

  return {
    integrate: createPipeline(integrateModule, 'integrate', layoutIntegrate),
    solve: createPipeline(solveModule, 'solve', layoutSolve),
    collide: createPipeline(collideModule, 'collide', layoutCollide),
    update: createPipeline(updateModule, 'updateVelocity', layoutUpdate),
    normals: createPipeline(normalsModule, 'computeNormals', layoutNormals),
    setPin: createPipeline(makeModule(SET_PIN_WGSL), 'setPin', layoutSetPin),
    selfClear: createPipeline(selfGridModule, 'clearSlots', layoutSelfGrid),
    selfFill: createPipeline(selfGridModule, 'fillSlots', layoutSelfGrid),
    selfProject: createPipeline(selfSolveModule, 'project', layoutSelfSolve),
    selfApply: createPipeline(selfSolveModule, 'applyPush', layoutSelfSolve),
    layouts: {
      integrate: layoutIntegrate,
      solve: layoutSolve,
      collide: layoutCollide,
      update: layoutUpdate,
      normals: layoutNormals,
      setPin: layoutSetPin,
      selfGrid: layoutSelfGrid,
      selfSolve: layoutSelfSolve,
    },
  };
}

/** Storage buffer sized to `data` (minimum 4 bytes) with its contents copied in. */
export function createStorageBuffer(device: GPUDevice, data: ArrayBufferView | null): GPUBuffer {
  const size = data ? data.byteLength : 4;
  const buf = device.createBuffer({
    size: Math.max(size, 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  if (data) device.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  return buf;
}

/** Uniform buffer of at least 16 bytes. */
export function createUniformBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(size, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}
