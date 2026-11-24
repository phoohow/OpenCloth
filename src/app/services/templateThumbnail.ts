import type { AvatarParams, Pattern, SimulationConfig } from '@/model/types';
import type { GarmentTemplate } from '@/pattern';
import type { AssetMesh, MaterialData } from '@/render/common';

import { makehumanBody } from '@/avatar';
import { buildMeshCollider, type AvatarCollider } from '@/avatar/collider';
import { computeVertexNormals } from '@/base/geom';
import { createDefaultProject } from '@/model';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { FALLBACK_PHYSICS, ClothAssembly, DressingController, SEW_FRAMES, BodyLandmarkCache } from '@/runtime';
import { createClothSimulator, type ClothSimulator } from '@/sim/solver';

const PREVIEW_RESOLUTION_CM = 3;

const SETTLE_FRAMES = 120;

const GARMENT_MATERIAL: MaterialData = {
  kind: 'surface',
  name: 'preview-garment',
  color: '#9aa1ad',
  roughness: 0.74,
  metalness: 0,
  sheen: 0.35,
  side: 'double',
};

let tail: Promise<unknown> = Promise.resolve();

export interface SettledGarment {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export function settleTemplate(
  template: GarmentTemplate,
  device: GPUDevice,
): Promise<SettledGarment | null> {
  const run = tail.then(() => settle(template, device), () => settle(template, device));
  tail = run.then(() => undefined, () => undefined);
  return run;
}

export function thumbnailMeshes(settled: SettledGarment): AssetMesh[] {
  return [{
    name: 'garment',
    mesh: {
      topology: 'triangle',
      streams: {
        position: settled.positions,
        normal: computeVertexNormals(settled.positions, settled.indices),
      },
      index: settled.indices,
    },
    material: GARMENT_MATERIAL,
  }];
}

async function settle(template: GarmentTemplate, device: GPUDevice): Promise<SettledGarment | null> {
  const project = createDefaultProject('template-preview');
  const fabricId = Object.keys(project.fabrics)[0];
  if (!fabricId) return null;
  project.pattern = template.generate(fabricId);

  const meshes = buildMeshes(project.pattern);
  if (meshes.size === 0) return null;
  const assembly = new ClothAssembly();
  const input = assembly.build(project, meshes, new BodyLandmarkCache());
  if (!input) return null;

  const simulator = createClothSimulator({ device: () => device });
  try {
    await simulator.setup(input, bodyCollider(project.avatar.params)?.mesh ?? null, project.scene.simulation);
    const controller = dressingController(simulator, assembly, input.positions);
    if (!(await controller.beginDress(project))) return null;

    let frames = 0;
    for (;;) {
      frames += 1;
      if (!(await controller.stepDressingFrame())) break;
    }

    for (let frame = frames; frame < SETTLE_FRAMES; frame++) {
      simulator.step(project.scene.simulation, FALLBACK_PHYSICS);
    }

    const { positions } = await simulator.readbackLatest();
    const resting = new Float32Array(input.particleCount * 3);
    resting.set(positions.subarray(0, resting.length));
    if (!hasFinitePositions(resting)) return null;
    return { positions: resting, indices: input.indices };
  } catch (error) {
    console.warn(`Template ${template.key} could not be simulated:`, error);
    return null;
  } finally {
    simulator.destroy();
  }
}

function dressingController(
  simulator: ClothSimulator,
  assembly: ClothAssembly,
  initial: Float32Array,
): DressingController {
  let steps = 0;
  return new DressingController({
    simulator: () => simulator,
    simReady: () => true,
    ensureSimulator: async () => undefined,
    step: async (config: SimulationConfig, fabric) => {
      simulator.step(config, fabric);
      if (++steps === SEW_FRAMES) await simulator.readbackLatest();
    },
    resetPositions: () => simulator.reset(initial),
    currentPositions: () => simulator.positions,
    dressTargets: () => assembly.dressPositions,
  });
}

function buildMeshes(pattern: Pattern): Map<string, PanelMesh> {
  const out = new Map<string, PanelMesh>();
  for (const panelId of Object.keys(pattern.panels)) {
    const mesh = buildPanelMesh(pattern, panelId, PREVIEW_RESOLUTION_CM);
    if (mesh) out.set(panelId, mesh);
  }

  return out;
}

function bodyCollider(params: AvatarParams): AvatarCollider | null {
  const body = makehumanBody(params);
  const triangles = new Float32Array(body.bodyIndices.length * 3);
  for (let i = 0; i < body.bodyIndices.length; i++) {
    const source = body.bodyIndices[i]! * 3;
    triangles[i * 3] = body.positions[source]!;
    triangles[i * 3 + 1] = body.positions[source + 1]!;
    triangles[i * 3 + 2] = body.positions[source + 2]!;
  }

  const mesh = buildMeshCollider(triangles);
  return mesh ? { mesh } : null;
}

function hasFinitePositions(positions: Float32Array): boolean {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) return false;
  }

  return positions.length > 0;
}
