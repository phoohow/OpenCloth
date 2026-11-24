import { COLLIDE_WGSL } from '@/sim/device/shaders/collide';
import { INTEGRATE_WGSL } from '@/sim/device/shaders/integrate';
import { NORMALS_WGSL } from '@/sim/device/shaders/normals';
import { SELF_COLLISION_GRID_WGSL, SELF_COLLISION_SOLVE_WGSL } from '@/sim/device/shaders/selfCollision';
import { SET_PIN_WGSL } from '@/sim/device/shaders/setPin';
import { SOLVE_WGSL } from '@/sim/device/shaders/solve';
import { UPDATE_WGSL } from '@/sim/device/shaders/update';

type BufferAccess = 'storage' | 'read-only-storage' | 'uniform';

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

export interface Programs {
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
  readonly modules: readonly GPUShaderModule[];
}

function createLayout(device: GPUDevice, accesses: BufferAccess[]): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: accesses.map((type, binding): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
}

export function createPrograms(device: GPUDevice): Programs {
  const makeModule = (code: string) => device.createShaderModule({ code });

  const integrateModule = makeModule(INTEGRATE_WGSL);
  const solveModule = makeModule(SOLVE_WGSL);
  const collideModule = makeModule(COLLIDE_WGSL);
  const updateModule = makeModule(UPDATE_WGSL);
  const normalsModule = makeModule(NORMALS_WGSL);
  const setPinModule = makeModule(SET_PIN_WGSL);
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
    setPin: createPipeline(setPinModule, 'setPin', layoutSetPin),
    selfClear: createPipeline(selfGridModule, 'clearSlots', layoutSelfGrid),
    selfFill: createPipeline(selfGridModule, 'fillSlots', layoutSelfGrid),
    selfProject: createPipeline(selfSolveModule, 'project', layoutSelfSolve),
    selfApply: createPipeline(selfSolveModule, 'applyPush', layoutSelfSolve),
    modules: [
      integrateModule, solveModule, collideModule, updateModule,
      normalsModule, setPinModule, selfGridModule, selfSolveModule,
    ],
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

export async function assertCompiled(programs: Programs): Promise<void> {
  const readable = programs.modules.filter(module => typeof module.getCompilationInfo === 'function');
  if (readable.length === 0) return;
  const infos = await Promise.all(readable.map(module => module.getCompilationInfo()));
  const errors: string[] = [];
  for (const info of infos) {
    for (const message of info.messages ?? []) {
      if (message.type === 'error') errors.push(`WGSL ${message.lineNum}:${message.linePos} ${message.message}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
}
